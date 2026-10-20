import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { BaseError, createWalletClient, custom, formatUnits, type Address } from 'viem';
import { address, chain, CHAIN_ID, EXPLORER, identifier, validateConfig, parseAmount, formatAmount, publicClient, createOwnerClient, type OwnerOperation, type WalletConfig } from '../../shared/owner.js';
import { metaMask, type Provider } from './metamask';

const failure = (error: unknown) => error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : 'Request failed.';
const operationKey = (config: WalletConfig) => `stable-token-allowance:v2:${config.alice.toLowerCase()}:${config.token.toLowerCase()}:operation`;
const unresolved = (op?: OwnerOperation) => !!op && ['prepared', 'submitted', 'unknown'].includes(op.status);
const skillUrl = 'https://raw.githubusercontent.com/stablelabs/agentic.stable.xyz/refs/heads/main/skills/agent-wallet-cli/SKILL.md';
const skillPageUrl = 'https://github.com/stablelabs/agentic.stable.xyz/blob/main/skills/agent-wallet-cli/SKILL.md';
export default function App() {
  const refreshId = useRef(0);
  const activeOwner = useRef<string | undefined>(undefined);
  const connectionId = useRef(0);
  const [config, setConfig] = useState<WalletConfig>();
  const [storageError, setStorageError] = useState('');
  const [storageReady, setStorageReady] = useState(false);
  const [provider, setProvider] = useState<Provider>();
  const [account, setAccount] = useState<Address>();
  const [agent, setAgent] = useState('');
  const [amount, setAmount] = useState(new URLSearchParams(location.search).get('amount') || '0.01');
  const [gasAmount, setGasAmount] = useState('0.01');
  const [allowance, setAllowance] = useState<bigint>();
  const [ownerBalance, setOwnerBalance] = useState<bigint>();
  const [gasBalance, setGasBalance] = useState<bigint>();
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [networkError, setNetworkError] = useState('');
  const [notice, setNotice] = useState('');
  const [operation, setOperation] = useState<OwnerOperation>();
  const [recoveredHash, setRecoveredHash] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);
  const [promptCopyError, setPromptCopyError] = useState('');
  const pending = unresolved(operation);
  const connected = verified && account?.toLowerCase() === config?.alice.toLowerCase();
  let setupPrompt = '';
  if (connected && config) {
    try {
      const budget = formatAmount(parseAmount(amount));
      const settings = validateConfig({ ...config, defaultAgent: undefined, approvalUrl: new URL(location.pathname, location.origin).href });
      const approvalLink = new URL(settings.approvalUrl);
      approvalLink.searchParams.set('agent', 'AGENT_SIGNER_ADDRESS');
      approvalLink.searchParams.set('amount', budget);
      setupPrompt = `Use the agent-wallet-cli skill at ${skillUrl} and follow its "Set up a signer" section.

My MetaMask owner address on Stable Testnet (chain 2201) is ${settings.alice}. Save it so you can configure payments later.

Create or reuse a signer, then return its address and an approval link requesting ${budget} USDT0 allowance. To build the link, replace AGENT_SIGNER_ADDRESS in this URL with the address that init returns:
${approvalLink.href}

Tell me if your storage might not persist between sessions. Stop before making any payment.`;
    } catch { /* An invalid allowance cannot become an instruction to the agent. */ }
  }
  useEffect(() => { setPromptCopied(false); setPromptCopyError(''); }, [setupPrompt]);

  useEffect(() => {
    fetch('/wallet-config.json', { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('Public wallet settings are missing. Run npm run wallet:configure -- --owner ADDRESS.');
      const c = validateConfig(await response.json()); setConfig(c);
      setAgent(new URLSearchParams(location.search).get('agent') || c.defaultAgent || '');
    }).catch(e => setError(failure(e)));
  }, []);
  useEffect(() => {
    setOperation(undefined); setRecoveredHash(''); setStorageReady(false); setStorageError('');
    if (!config || !account) return;
    try {
      const saved = JSON.parse(localStorage.getItem(operationKey(config)) || 'null') as OwnerOperation | null;
      if (saved) {
        if (saved.schemaVersion !== 2 || saved.chainId !== CHAIN_ID || saved.alice.toLowerCase() !== config.alice.toLowerCase() || saved.token.toLowerCase() !== config.token.toLowerCase() || !['approve', 'fund'].includes(saved.action) || !['prepared', 'submitted', 'confirmed', 'reverted', 'rejected', 'unknown'].includes(saved.status) || !saved.intent || !/^(0|[1-9]\d*)$/.test(saved.intent.amount)) throw new Error('Invalid saved operation');
        address(saved.intent.agent); identifier(saved.operationId);
        if (saved.hash) identifier(saved.hash);
        setOperation(saved);
        if (unresolved(saved)) setAgent(saved.intent.agent);
        if (unresolved(saved)) setNotice('A previous wallet operation is unverified. Check its confirmation before another approval or gas transfer.');
      }
      setStorageReady(true);
    } catch { setStorageError('Cannot read saved wallet operations. Restore access to browser storage before submitting.'); }
  }, [config, account]);
  const refresh = useCallback(async () => {
    if (!config) return;
    if (account?.toLowerCase() !== activeOwner.current) return;
    const requestId = ++refreshId.current;
    try {
      const owner = createOwnerClient({ config, publicClient: publicClient(config.rpcUrl) });
      await owner.verifyNetwork();
      if (requestId !== refreshId.current) return;
      if (!account) { setVerified(true); setNetworkError(''); return; }
      if (!agent.trim()) {
        const balances = await owner.getBalances();
        if (requestId !== refreshId.current) return;
        setVerified(true); setOwnerBalance(balances.aliceToken); setAllowance(undefined); setGasBalance(undefined); setNetworkError(''); return;
      }
      const selected = address(agent, 'agent address');
      const [remaining, balances] = await Promise.all([owner.getAllowance(selected), owner.getBalances(selected)]);
      if (requestId !== refreshId.current) return;
      setVerified(true); setAllowance(remaining); setOwnerBalance(balances.aliceToken); setGasBalance(balances.agentNative); setNetworkError('');
    } catch (e) { if (requestId !== refreshId.current) return; setVerified(false); setAllowance(undefined); setGasBalance(undefined); setNetworkError(failure(e)); }
  }, [config, agent, account]);
  useEffect(() => {
    setVerified(false); setAllowance(undefined); setGasBalance(undefined);
    let alive = true;
    const timer = setTimeout(() => { if (alive) void refresh(); }, 150);
    const interval = setInterval(() => { if (alive) void refresh(); }, 15_000);
    return () => { alive = false; refreshId.current++; clearTimeout(timer); clearInterval(interval); };
  }, [refresh]);
  useEffect(() => {
    if (!provider) return;
    const invalidate = () => { disconnect(); setNotice('Wallet account or network changed. Reconnect MetaMask to continue.'); };
    provider.on?.('accountsChanged', invalidate); provider.on?.('chainChanged', invalidate); provider.on?.('disconnect', invalidate);
    return () => { provider.removeListener?.('accountsChanged', invalidate); provider.removeListener?.('chainChanged', invalidate); provider.removeListener?.('disconnect', invalidate); };
  }, [provider]);
  function disconnect() {
    connectionId.current++; refreshId.current++; activeOwner.current = undefined;
    setAccount(undefined); setVerified(false); setOwnerBalance(undefined); setAllowance(undefined); setGasBalance(undefined);
    setOperation(undefined); setRecoveredHash(''); setStorageReady(false); setStorageError(''); setError(''); setNetworkError(''); setNotice('');
  }
  function ownerActions(wallet?: ReturnType<typeof createWalletClient>) {
    const revision = connectionId.current;
    return createOwnerClient({ config: config!, publicClient: publicClient(config!.rpcUrl), walletClient: wallet,
      onOperation: op => { localStorage.setItem(operationKey(config!), JSON.stringify(op)); if (revision === connectionId.current && activeOwner.current === op.alice.toLowerCase()) setOperation(op); },
    });
  }
  async function connect() {
    if (!config) return;
    disconnect(); setBusy(true);
    try {
      const p = await metaMask(); setProvider(p);
      const accounts = await p.request({ method: 'eth_requestAccounts' });
      if (!accounts[0]) throw new Error('No account was shared. Unlock MetaMask and select an account to connect.');
      const selected = address(accounts[0], 'wallet account');
      const selectedConfig = validateConfig({ ...config, alice: selected });
      try { await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x899' }] }); }
      catch (e) {
        if ((e as { code?: number }).code !== 4902) throw e;
        await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x899', chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: [config.rpcUrl], blockExplorerUrls: [EXPLORER] }] });
        await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x899' }] });
      }
      if (Number(await p.request({ method: 'eth_chainId' })) !== CHAIN_ID) throw new Error('Select Stable Testnet.');
      await createOwnerClient({ config: selectedConfig, publicClient: publicClient(selectedConfig.rpcUrl) }).verifyNetwork();
      const currentAccounts = await p.request({ method: 'eth_accounts' });
      if (currentAccounts[0]?.toLowerCase() !== selected.toLowerCase() || Number(await p.request({ method: 'eth_chainId' })) !== CHAIN_ID) throw new Error('Wallet account or network changed while connecting. Connect MetaMask again.');
      activeOwner.current = selected.toLowerCase();
      setConfig(selectedConfig); setAccount(selected); setVerified(true); setNotice('Owner connected. Review the agent address and allowance before approving.');
    } catch (e) { disconnect(); setError(failure(e)); }
    finally { setBusy(false); }
  }
  function downloadConfig() {
    if (!config || !connected) return;
    const settings = validateConfig({ ...config, defaultAgent: agent.trim() ? address(agent, 'agent address') : undefined });
    const url = URL.createObjectURL(new Blob([JSON.stringify(settings, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'wallet-config.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function copySetupPrompt() {
    if (!setupPrompt) return;
    const revision = connectionId.current;
    try {
      await navigator.clipboard.writeText(setupPrompt);
      if (revision === connectionId.current) { setPromptCopied(true); setPromptCopyError(''); }
    } catch {
      if (revision === connectionId.current) { setPromptCopied(false); setPromptCopyError('Clipboard access is blocked. Open the setup prompt below, select the text, and copy it into your agent app.'); }
    }
  }
  async function ownerClient() {
    if (!config || !provider || !account) throw new Error('Connect the wallet owner in MetaMask first.');
    const accounts = await provider.request({ method: 'eth_accounts' });
    if (accounts[0]?.toLowerCase() !== config.alice.toLowerCase() || Number(await provider.request({ method: 'eth_chainId' })) !== CHAIN_ID) throw new Error('Select the wallet owner on Stable Testnet and reconnect.');
    return ownerActions(createWalletClient({ account, chain, transport: custom(provider) }));
  }
  async function confirm(op: OwnerOperation) {
    const revision = connectionId.current;
    const result = await ownerActions().wait(op);
    if (revision !== connectionId.current || activeOwner.current !== op.alice.toLowerCase()) return;
    setNotice(`${op.action === 'fund' ? 'Agent gas funding' : BigInt(op.intent.amount) === 0n ? 'Allowance revocation' : 'Agent approval'} ${result.success ? 'confirmed onchain' : 'reverted'}.`);
    await refresh();
  }
  async function submit(action: 'approve' | 'revoke' | 'fund') {
    if (!config || busy || pending || !storageReady) return;
    const revision = connectionId.current;
    setBusy(true); setError('');
    try {
      const owner = await ownerClient();
      setNotice('Review and confirm this transaction in MetaMask. The wallet owner pays its gas.');
      const op = action === 'fund' ? await owner.fundAgentGas({ agent, amount: gasAmount })
        : action === 'revoke' ? await owner.revoke(agent) : await owner.approve({ agent, amount });
      if (revision === connectionId.current) setNotice('Submitted. Waiting for onchain confirmation…'); await confirm(op);
    } catch (e) { if (revision === connectionId.current) { setError(failure(e)); setNotice('Check the saved operation and MetaMask history before retrying an uncertain submission.'); } }
    finally { setBusy(false); }
  }
  async function reconcile(event?: FormEvent) {
    event?.preventDefault(); if (!operation || busy) return;
    setBusy(true); setError('');
    try { await confirm(operation.hash ? operation : { ...operation, hash: identifier(recoveredHash), status: 'submitted' }); }
    catch (e) { setError(failure(e)); }
    finally { setBusy(false); }
  }
  return <div className="shell">
    <header><a className="brand" href="/">stable<span> / Agent spending</span></a><span className="network"><i /> Stable Testnet · 2201</span></header>
    <main>
      <div className="intro"><p className="eyebrow">DIRECT ERC-20 APPROVALS</p><h1>Your tokens.<br /><span>Your agent’s allowance.</span></h1><p>Approve an agent signer to spend test USDT0 from your wallet.<br />The agent uses its own key to pay from that allowance.</p></div>
      <section className="account-panel" aria-label="Wallet owner">
        <div><p className="eyebrow">WALLET OWNER</p><p className="address">{account || 'Connect your MetaMask account to try the demo'}</p><p className="account-meta">{verified ? '✓ Token network verified' : 'Token network unverified'}{ownerBalance !== undefined ? ` · ${formatAmount(ownerBalance)} USDT0 available` : ''}</p></div>
        <div className="actions"><button className="primary" disabled={busy || !config || connected} onClick={() => void connect()}>{connected ? 'Owner connected' : busy ? 'Connecting…' : 'Connect MetaMask'}</button>{account && <button disabled={busy} onClick={disconnect}>Disconnect</button>}</div>
      </section>
      <p className="form-note">Use your own account in the MetaMask extension or MetaMask’s mobile browser. Connecting requests account access; approval and gas funding each need a separate confirmation. <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">Get MetaMask ↗</a> · <a href="https://faucet.stable.xyz" target="_blank" rel="noreferrer">Get test USDT0 ↗</a></p>
      {(storageError || error || networkError) && <div className="message error" role="alert">{storageError || error || networkError}</div>}
      {notice && <div className="message" role="status">{notice}</div>}
      {operation?.hash && <p className="transaction">Latest transaction: <a href={`${EXPLORER}/tx/${operation.hash}`} target="_blank" rel="noreferrer">{operation.hash} ↗</a></p>}
      {pending && <section className="message" aria-label="Pending operation"><p>This {operation!.action === 'fund' ? 'gas transfer' : 'token approval'} is unverified. Another submission is blocked until its outcome is confirmed.</p><p>Agent: {operation!.intent.agent}<br />Amount: {formatUnits(BigInt(operation!.intent.amount), operation!.action === 'fund' ? 18 : 6)} {operation!.action === 'fund' ? 'native USDT0' : 'USDT0'}</p>
        {operation!.hash ? <button disabled={busy} onClick={() => void reconcile()}>Check confirmation</button>
          : <form onSubmit={event => void reconcile(event)}><label>Transaction hash from MetaMask<input required value={recoveredHash} onChange={e => setRecoveredHash(e.target.value)} placeholder="0x…" /></label><button disabled={busy} type="submit">Verify transaction</button><p>If MetaMask shows that nothing was submitted, retain this record and resolve it before continuing. Do not send another transaction to recover an unknown outcome.</p></form>}
      </section>}
      <section className="create-panel" aria-label="Set up your agent">
        <p className="eyebrow">CONNECT YOUR AGENT</p><h2>Set up your agent</h2>
        <p className="form-note">Copy the setup prompt into your agent app. It will use the GitHub skill to set up its wallet and return a link with its address and allowance filled in. Your MetaMask private key stays with you.</p>
        <ol className="setup-steps"><li>Copy the prompt and paste it into an agent with terminal access.</li><li>Let your agent handle setup, then open the approval link it returns.</li><li>Connect MetaMask on that page, review the allowance, and fund the agent’s gas.</li></ol>
        <div className="actions"><button className="primary" disabled={!setupPrompt || busy} onClick={() => void copySetupPrompt()}>{promptCopied ? 'Setup prompt copied' : 'Copy setup prompt'}</button><a href={skillPageUrl} target="_blank" rel="noreferrer">View skill ↗</a><a href="#agent-allowance">I already have an agent address ↓</a></div>
        <p className="form-note" aria-live="polite">{!connected ? 'Connect MetaMask above to include your wallet’s public address.' : !setupPrompt ? 'Enter a valid allowance amount below to generate the setup prompt.' : promptCopyError || (promptCopied ? 'Paste the prompt into your agent app. When setup finishes, open the approval link it returns.' : 'The prompt includes your public wallet address and the allowance amount below. Setup does not send a payment.')}</p>
        {setupPrompt && <details className="setup-prompt" open={promptCopyError ? true : undefined}><summary>View or manually copy setup prompt</summary><textarea aria-label="Agent setup prompt" readOnly value={setupPrompt} rows={9} onFocus={event => event.currentTarget.select()} /></details>}
      </section>
      <section className="message"><strong>What this permission allows</strong><p>The agent can send up to its remaining allowance to any recipient. There is no automatic expiry. Revoke the allowance to stop future spending; confirmed payments cannot be undone.</p></section>
      <form id="agent-allowance" className="create-panel" aria-label="Approve agent" onSubmit={event => { event.preventDefault(); void submit('approve'); }}>
        <p className="eyebrow">APPROVE YOUR AGENT</p><h2>Set a token allowance</h2><p className="form-note">Approve the agent’s own address on the USDT0 token. Funds stay in the owner’s wallet until the agent spends them.</p>
        <div className="form-grid"><label>Agent signer<input aria-label="Agent signer" required value={agent} onChange={e => setAgent(e.target.value)} disabled={busy || pending} placeholder="0x…" autoComplete="off" spellCheck={false} />{agent && <small className="input-address">{agent}</small>}</label>
          <label>Allowance amount (USDT0)<input required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} disabled={busy || pending} /></label></div>
        <p aria-live="polite">Remaining token allowance: <strong>{!agent.trim() ? 'Enter an agent address' : allowance === undefined ? 'Unavailable' : `${formatAmount(allowance)} USDT0`}</strong></p>
        {allowance !== undefined && allowance > 0n && <p className="form-note">To change the amount, first revoke the remaining allowance to zero and wait for confirmation, then approve the new amount.</p>}
        <div className="actions"><button className="primary" type="submit" disabled={!connected || !storageReady || busy || pending || allowance === undefined || allowance > 0n}>Approve agent</button>
          <button type="button" disabled={!connected || !storageReady || busy || pending || allowance === undefined || allowance === 0n} onClick={() => void submit('revoke')}>Revoke allowance</button>
          <button type="button" disabled={busy || !config} onClick={() => void refresh()}>Refresh</button></div>
      </form>
      <form className="create-panel" aria-label="Agent gas" onSubmit={event => { event.preventDefault(); void submit('fund'); }}>
        <p className="eyebrow">FUND THE AGENT’S TRANSACTION FEES</p><h2>Agent gas</h2><p>Agent gas balance: <strong>{!agent.trim() ? 'Enter an agent address' : gasBalance === undefined ? 'Unavailable' : `${formatUnits(gasBalance, 18)} native USDT0`}</strong></p>
        <p className="form-note">This separate transfer belongs to the selected agent and does not use its token allowance. Revoking the allowance does not return gas funding. Choose an amount; this is not a fee estimate.</p>
        <label>Gas top-up (native USDT0)<input required inputMode="decimal" value={gasAmount} onChange={e => setGasAmount(e.target.value)} disabled={busy || pending} /></label>
        <button className="primary" type="submit" disabled={!connected || !storageReady || busy || pending || allowance === undefined}>Fund agent gas</button>
      </form>
      <section className="create-panel" aria-label="Send an agent payment">
        <p className="eyebrow">NEXT: PAY FROM THE AGENT</p><h2>Use the agent CLI</h2>
        <p className="form-note">With Node.js 22+, install the standalone CLI. For a new signer, run <code>agent-wallet init --json</code> in your chosen state directory, then paste its address into Agent signer above. Reuse your existing state directory if you already have a signer. Check that <code>whoami</code> prints the same agent address shown above.</p>
        <button disabled={!connected || busy} onClick={() => { try { downloadConfig(); } catch (e) { setError(failure(e)); } }}>Download wallet settings</button>
        <p className="form-note">Connect MetaMask to download public settings for your wallet, then import that downloaded file below. Your private key stays in MetaMask.</p>
        <pre><code>{`npm install --global @stablechain/agent-wallet-cli@0.2.0
export WALLET_STATE_DIR="/absolute/path/to/existing/signer"
agent-wallet whoami --json
agent-wallet config import --file /absolute/path/wallet-config.json --json
agent-wallet allowance show --json
agent-wallet payments prepare --recipient RECIPIENT_ADDRESS --amount 0.001 --json`}</code></pre>
        <p className="form-note">Replace RECIPIENT_ADDRESS. Save the returned paymentId, then simulate and submit that same payment:</p>
        <pre><code>{`agent-wallet pay --payment-id PAYMENT_ID --dry-run --json
agent-wallet pay --payment-id PAYMENT_ID --json`}</code></pre>
        <p className="form-note">Use one state directory for every command. Payment IDs are local recovery records; creating another ID can send another payment. <a href="https://www.npmjs.com/package/@stablechain/agent-wallet-cli/v/0.2.0" target="_blank" rel="noreferrer">CLI setup and recovery guide ↗</a></p>
      </section>
    </main><footer><p>Test-only proof of concept · USDT0 on Stable Testnet.</p><p>The owner pays approval and funding fees. The agent pays transferFrom fees. Token allowance is a spending cap, with no recipient restriction or expiry.</p></footer>
  </div>;
}
