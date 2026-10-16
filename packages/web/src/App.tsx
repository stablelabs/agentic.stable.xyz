import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { BaseError, createWalletClient, custom, formatUnits, type Hex, type Address } from 'viem';
import { chain, CHAIN_ID, EXPLORER, identifier, validateConfig, type WalletConfig, formatAmount, newGrantId, type GrantDraft, grantStatus, publicClient, type Grant, createOwnerClient, type OwnerOperation } from '@stablechain/agent-wallet-sdk';
import { metaMask, type Provider } from './metamask';
import GasFunding from './GasFunding';

type Row = { id: Hex; grant: Grant };
type SavedTx = { operation?: OwnerOperation; hash: Hex; alice: Address; action: string; grantId: Hex; status: number; creation?: { agent: Address; recipient: Address; budget: string; expiresAt: string }; funding?: { agent: Address; amount: string } };
const txKey = 'stable-agent-wallet:last-transaction';
const operationKey = 'stable-agent-wallet:owner-operation';
const draftKey = (alice: string) => `stable-agent-wallet:v2:draft:${alice.toLowerCase()}`;
const failure = (e: unknown) => e instanceof BaseError ? `${e.shortMessage}${e.details ? ` ${e.details}` : ''}` : e instanceof Error ? e.message : 'Request failed.';

export default function App() {
  const [config, setConfig] = useState<WalletConfig>();
  const [provider, setProvider] = useState<Provider>();
  const [account, setAccount] = useState<Address>();
  const [verified, setVerified] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [count, setCount] = useState(0n);
  const [page, setPage] = useState(0);
  const [balance, setBalance] = useState<bigint>();
  const [now, setNow] = useState(0n);
  const [error, setError] = useState('');
  const [networkError, setNetworkError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingFunding, setPendingFunding] = useState(false);
  const [unresolvedFunding, setUnresolvedFunding] = useState<OwnerOperation>();
  const [fundingHash, setFundingHash] = useState('');
  const [tx, setTx] = useState<SavedTx>();
  const [draft, setDraft] = useState<GrantDraft>();
  const refreshing = useRef(false);
  const selected = new URLSearchParams(location.search).get('grant');

  useEffect(() => {
    fetch('/wallet-config.json', { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('Local setup is required. Run npm run wallet:enable locally.');
      setConfig(validateConfig(await response.json()));
    }).catch(e => setError(failure(e)));
  }, []);
  useEffect(() => {
    if (!config) return;
    const params = new URLSearchParams(location.search);
    let stored: GrantDraft | undefined;
    try { stored = JSON.parse(localStorage.getItem(draftKey(config.alice)) || 'null') || undefined; } catch { /* Storage may be disabled. */ }
    try {
      setDraft(params.has('newGrant') ? {
        id: identifier(params.get('newGrant')!), agent: params.get('agent') || config.defaultAgent || '',
        recipient: params.get('recipient') || '', budget: params.get('budget') || '0.01', expires: params.get('expires') || '',
      } : stored || { id: newGrantId(), agent: config.defaultAgent || '', recipient: '', budget: '0.01', expires: new Date(Date.now() + 86400_000).toISOString().replace(/\.\d{3}Z$/, 'Z') });
    } catch (e) { setError(failure(e)); }
  }, [config]);
  useEffect(() => { if (config && draft) { try { localStorage.setItem(draftKey(config.alice), JSON.stringify(draft)); } catch { /* Draft ID remains visible. */ } } }, [config, draft]);

  const refresh = useCallback(async () => {
    if (!config || refreshing.current) return;
    refreshing.current = true;
    try {
      const owner = createOwnerClient({ config, publicClient: publicClient(config.rpcUrl) });
      await owner.verifyAccount();
      let listing = await owner.listGrants();
      if (page > 0 && listing.cursor) {
        const cursor = listing.cursor.split(':');
        cursor[2] = String(listing.total > BigInt(page * 20) ? listing.total - BigInt(page * 20) : 0n);
        listing = await owner.listGrants({ cursor: cursor.join(':') });
      }
      const items = [...listing.items];
      if (selected) {
        const id = identifier(selected);
        if (!items.some(item => item.id === id)) items.unshift(await owner.getGrant(id, listing.block));
      }
      const balances = await owner.getBalances();
      setRows(items.filter(row => row.grant.status !== 0)); setCount(listing.total); setBalance(balances.aliceToken); setNow(listing.timestamp); setVerified(true); setNetworkError('');
    } catch (e) { setVerified(false); setNetworkError(failure(e)); }
    finally { refreshing.current = false; }
  }, [config, page, selected]);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 15_000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => {
    if (!provider) return;
    const invalidate = () => { setAccount(undefined); setNotice('Wallet account or network changed. Connect Alice again.'); };
    provider.on?.('accountsChanged', invalidate); provider.on?.('chainChanged', invalidate);
    return () => { provider.removeListener?.('accountsChanged', invalidate); provider.removeListener?.('chainChanged', invalidate); };
  }, [provider]);
  function ownerSdk(wallet?: ReturnType<typeof createWalletClient>) {
    return createOwnerClient({ config: config!, publicClient: publicClient(config!.rpcUrl), walletClient: wallet,
      onOperation: operation => {
        localStorage.setItem(operationKey, JSON.stringify(operation));
        if (operation.action === 'fund') {
          setPendingFunding(['prepared', 'submitted', 'unknown'].includes(operation.status));
          setUnresolvedFunding(['prepared', 'unknown'].includes(operation.status) ? operation : undefined);
        }
      },
    });
  }
  function savedOperation(operation: OwnerOperation): SavedTx {
    return { operation, hash: operation.hash!, alice: operation.alice, grantId: operation.grantId,
      action: operation.action === 'fund' ? 'Agent gas funding' : operation.action === 'create' ? 'Grant creation' : operation.action,
      status: operation.action === 'revoke' ? 4 : operation.action === 'reject' ? 3 : 2,
      ...(operation.action === 'fund' ? { funding: { agent: operation.intent.agent as Address, amount: operation.intent.amount } } : {}),
      ...(operation.action === 'create' ? { creation: { agent: operation.intent.agent as Address, recipient: operation.intent.recipient as Address, budget: operation.intent.budget, expiresAt: operation.intent.expiresAt } } : {}),
    };
  }
  function trackSaved(saved: SavedTx) {
    const operation: OwnerOperation = saved.operation || {
      schemaVersion: 1, chainId: 2201, alice: saved.alice, implementation: config!.implementation,
      action: saved.funding ? 'fund' : saved.creation ? 'create' : saved.status === 4 ? 'revoke' : saved.status === 2 ? 'approve' : 'reject',
      grantId: saved.grantId, hash: saved.hash, status: 'submitted',
      intent: saved.funding ? { agent: saved.funding.agent, amount: saved.funding.amount }
        : saved.creation ? { ...saved.creation } : {},
    };
    return ownerSdk().wait(operation);
  }
  useEffect(() => {
    if (!config) return;
    let alive = true;
    try {
      const pending = JSON.parse(localStorage.getItem(operationKey) || 'null') as OwnerOperation | null;
      if (pending?.alice === config.alice && pending.action === 'fund' && ['prepared', 'unknown'].includes(pending.status)) {
        setPendingFunding(true);
        setUnresolvedFunding(pending);
        setNotice('Gas funding is unverified. Reconcile the transfer in MetaMask before another top-up.');
        // An older confirmed funding hash must not clear this newer unknown transfer.
        if (!pending.hash) return () => { alive = false; };
      }
      const saved = pending?.hash && pending.alice === config.alice ? savedOperation(pending) : JSON.parse(localStorage.getItem(txKey) || 'null') as SavedTx | null;
      if (saved && saved.alice.toLowerCase() === config.alice.toLowerCase()) {
        setTx(saved);
        if (saved.funding) setPendingFunding(true);
        trackSaved(saved).then(result => {
          if (!alive) return;
          if (saved.funding) setPendingFunding(false);
          setNotice(`${saved.action}: ${result.success ? 'confirmed' : 'reverted'}.`);
          if (result.success && saved.creation) setDraft(d => d?.id === saved.grantId ? { ...d, id: newGrantId() } : d);
          void refresh();
        }).catch(e => { if (alive) setNotice(`Previous transaction is unverified: ${failure(e)}`); });
      }
    } catch { /* Browser storage may be disabled. */ }
    return () => { alive = false; };
  }, [config]);

  async function connect() {
    if (!config) return;
    setBusy(true); setError('');
    try {
      const p = await metaMask(); setProvider(p);
      const accounts = await p.request({ method: 'eth_requestAccounts' });
      if (accounts[0]?.toLowerCase() !== config.alice.toLowerCase()) throw new Error(`Select Alice’s account in MetaMask: ${config.alice}`);
      try { await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x899' }] }); }
      catch (e) {
        if ((e as { code?: number }).code !== 4902) throw e;
        await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x899', chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: [config.rpcUrl], blockExplorerUrls: [EXPLORER] }] });
        await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x899' }] });
      }
      if (Number(await p.request({ method: 'eth_chainId' })) !== CHAIN_ID) throw new Error('MetaMask must use Stable Testnet.');
      await createOwnerClient({ config, publicClient: publicClient(config.rpcUrl) }).verifyAccount();
      setAccount(accounts[0]); setNotice('Alice connected. Create a grant with the exact permissions you want to authorize.');
      await refresh();
    } catch (e) { setAccount(undefined); setError(failure(e)); }
    finally { setBusy(false); }
  }
  async function ownerClient() {
    if (!config || !provider || !account) throw new Error('Connect Alice in MetaMask first.');
    const accounts = await provider.request({ method: 'eth_accounts' });
    if (accounts[0]?.toLowerCase() !== config.alice.toLowerCase() || Number(await provider.request({ method: 'eth_chainId' })) !== CHAIN_ID) throw new Error('Select Alice on Stable Testnet and reconnect.');
    return ownerSdk(createWalletClient({ account, chain, transport: custom(provider) }));
  }
  async function confirm(saved: SavedTx) {
    setTx(saved);
    if (saved.funding) setPendingFunding(true);
    try { localStorage.setItem(txKey, JSON.stringify(saved)); } catch { /* Hash remains visible. */ }
    setNotice('Submitted. Waiting for onchain confirmation…');
    const result = await trackSaved(saved);
    if (saved.funding) setPendingFunding(false);
    if (result.hash !== saved.hash) { saved.hash = result.hash; if (saved.operation) saved.operation.hash = result.hash; setTx({ ...saved }); try { localStorage.setItem(txKey, JSON.stringify(saved)); } catch {} }
    if (!result.success) throw new Error('Transaction reverted. Network fees may apply.');
    setNotice(`${saved.action} confirmed onchain.${saved.creation ? ` Active grant ID: ${saved.grantId}` : ''}`);
    if (saved.creation) setDraft(d => d?.id === saved.grantId ? { ...d, id: newGrantId() } : d);
    await refresh();
  }
  async function create(event: FormEvent) {
    event.preventDefault(); if (!config || !draft || busy || pendingFunding) return;
    setBusy(true); setError('');
    try {
      const owner = await ownerClient();
      localStorage.setItem(draftKey(config.alice), JSON.stringify(draft));
      setNotice('Confirm grant creation and authorization in MetaMask. Alice pays this transaction’s gas.');
      const operation = await owner.createGrant(draft);
      await confirm({ operation, hash: operation.hash!, alice: config.alice, action: 'Grant creation', grantId: operation.grantId, status: 2,
        creation: { agent: operation.intent.agent as Address, recipient: operation.intent.recipient as Address, budget: operation.intent.budget, expiresAt: operation.intent.expiresAt } });
    } catch (e) { setError(failure(e)); setNotice('Check any submitted transaction before retrying.'); }
    finally { setBusy(false); }
  }
  async function act(row: Row, action: 'approveGrant' | 'rejectGrant' | 'revokeGrant') {
    if (!config || busy || pendingFunding) return;
    setBusy(true); setError('');
    try {
      const owner = await ownerClient();
      const current = (await owner.getGrant(row.id)).grant;
      if (current.agent !== row.grant.agent || current.recipient !== row.grant.recipient || current.budget !== row.grant.budget || current.expiresAt !== row.grant.expiresAt) throw new Error('Request terms changed. Refresh and review again.');
      setNotice('Confirm this action in MetaMask…');
      const operation = action === 'revokeGrant' ? await owner.revokeGrant(row.id)
        : action === 'approveGrant' ? await owner.legacy.approveGrant(row.id) : await owner.legacy.rejectGrant(row.id);
      await confirm({ operation, hash: operation.hash!, alice: config.alice, action: action.replace('Grant', ''), grantId: row.id, status: action === 'approveGrant' ? 2 : action === 'rejectGrant' ? 3 : 4 });
    } catch (e) { setError(failure(e)); setNotice('Check any submitted transaction before retrying.'); }
    finally { setBusy(false); }
  }
  async function fundAgent(id: Hex, agent: Address, amount: bigint) {
    if (!config || busy || pendingFunding) return;
    setBusy(true); setError('');
    try {
      const owner = await ownerClient();
      const current = await owner.getGrant(id);
      if (current.grant.agent.toLowerCase() !== agent.toLowerCase() || current.status !== 'Active') throw new Error('Grant is no longer active for this agent. Refresh and review its status.');
      setNotice(`Confirm a separate transfer of ${formatUnits(amount, 18)} native USDT0 to agent ${agent} in MetaMask. Alice also pays the transfer fee.`);
      const operation = await owner.fundAgentGas({ grantId: id, amount: formatUnits(amount, 18) });
      await confirm({ operation, hash: operation.hash!, alice: config.alice, action: 'Agent gas funding', grantId: id, status: 2, funding: { agent, amount: String(amount) } });
    } catch (e) { setError(failure(e)); setNotice('Check any submitted funding transaction before retrying. The grant remains authorized.'); }
    finally { setBusy(false); }
  }
  async function checkFunding() {
    if (!tx?.funding || busy) return;
    setBusy(true); setError('');
    try { await confirm(tx); } catch (e) { setError(failure(e)); }
    finally { setBusy(false); }
  }
  async function reconcileFunding(event: FormEvent) {
    event.preventDefault();
    if (!unresolvedFunding || busy) return;
    setBusy(true); setError('');
    try { await confirm(savedOperation({ ...unresolvedFunding, hash: identifier(fundingHash), status: 'submitted' })); }
    catch (error) { setError(failure(error)); }
    finally { setBusy(false); }
  }
  const connected = account?.toLowerCase() === config?.alice.toLowerCase() && verified;
  return <div className="shell">
    <header><a className="brand" href="/">stable<span> / Agent Wallet</span></a><span className="network"><i /> Stable Testnet · 2201</span></header>
    <main>
      <div className="intro"><p className="eyebrow">ONCHAIN SPENDING PERMISSIONS</p><h1>Your account.<br /><span>Your agent’s limits.</span></h1><p>Create spending permissions for your agent.<br />Every payment is checked by your account’s contract.</p></div>
      <section className="account-panel" aria-label="Alice account">
        <div><p className="eyebrow">ALICE’S EXISTING ADDRESS</p><p className="address">{config?.alice || 'Awaiting local setup'}</p><p className="account-meta">{verified ? '✓ Account code verified' : 'Account code unverified'}{balance !== undefined && verified ? ` · ${formatAmount(balance)} USDT0 available` : ''}</p></div>
        <button className="primary" disabled={busy || !config} onClick={() => void connect()}>{connected ? 'Alice connected' : 'Connect MetaMask'}</button>
      </section>
      {(error || networkError) && <div className="message error" role="alert">{error || networkError}</div>}
      {notice && <div className="message" role="status">{notice}</div>}
      {tx && <p className="transaction">Latest transaction: <a href={`${EXPLORER}/tx/${tx.hash}`} target="_blank" rel="noreferrer">{tx.hash} ↗</a></p>}
      {pendingFunding && <div className="message"><p>Check the submitted gas funding transaction before sending another top-up.</p><button disabled={busy} onClick={() => void checkFunding()}>Check funding confirmation</button></div>}
      {unresolvedFunding && !busy && <form className="message" onSubmit={event => void reconcileFunding(event)}>
        <p>Find this gas transfer in MetaMask and paste its transaction hash to verify the recipient and amount.</p>
        <label>Funding transaction hash<input required value={fundingHash} onChange={event => setFundingHash(event.target.value)} placeholder="0x…" /></label>
        <button type="submit">Verify funding transaction</button>
      </form>}
      {draft && <form className="create-panel" onSubmit={event => void create(event)} aria-label="Create agent grant">
        <p className="eyebrow">ALICE CREATES THE GRANT</p><h2>Authorize an agent to spend</h2><p className="form-note">One MetaMask confirmation creates an Active grant. Alice pays the creation fee. After creation, check the agent’s gas balance and fund it below if needed.</p>
        <div className="form-grid"><label>Agent signer<input aria-label="Agent signer" required value={draft.agent} onChange={e => setDraft({ ...draft, agent: e.target.value })} placeholder="0x…" disabled={busy} autoComplete="off" spellCheck={false} />{draft.agent && <small className="input-address" aria-hidden="true">{draft.agent}</small>}</label><label>Allowed recipient<input aria-label="Allowed recipient" required value={draft.recipient} onChange={e => setDraft({ ...draft, recipient: e.target.value })} placeholder="0x…" disabled={busy} autoComplete="off" spellCheck={false} />{draft.recipient && <small className="input-address" aria-hidden="true">{draft.recipient}</small>}</label><label>Cumulative budget (USDT0)<input required inputMode="decimal" value={draft.budget} onChange={e => setDraft({ ...draft, budget: e.target.value })} disabled={busy} /></label><label>Expires (UTC)<input required value={draft.expires} onChange={e => setDraft({ ...draft, expires: e.target.value })} placeholder="2026-10-15T18:00:00Z" disabled={busy} /></label></div>
        <p className="draft-id">Grant ID: <code>{draft.id}</code></p><button className="primary" type="submit" disabled={!connected || busy || pendingFunding}>Create and authorize grant</button>
      </form>}
      <div className="section-title"><div><p className="eyebrow">EXISTING GRANTS</p><h2>Permissions you control <span>{String(count)}</span></h2></div><button disabled={busy || !config} onClick={() => void refresh()}>Refresh</button></div>
      {!rows.length && <div className="empty"><span>↗</span><h3>No grants yet</h3><p>Connect Alice and create a grant above.<br />The agent uses its confirmed grant ID to make payments.</p></div>}
      <div className="grants">{rows.map(row => {
        const g = row.grant; const status = grantStatus(g, now); const pending = g.status === 1; const active = g.status === 2;
        return <article className={`grant ${selected === row.id ? 'selected' : ''}`} key={row.id}>
          <div className="grant-heading"><h3>Agent spending grant</h3><span className={`status ${status.toLowerCase()}`}>{status}</span></div>
          <dl><div><dt>Agent signer</dt><dd>{g.agent}</dd></div><div><dt>Allowed recipient</dt><dd>{g.recipient}</dd></div><div className="terms"><div><dt>Cumulative budget</dt><dd>{formatAmount(g.budget)} <small>USDT0</small></dd></div><div><dt>Spent</dt><dd>{formatAmount(g.spent)} <small>USDT0</small></dd></div><div><dt>Remaining budget</dt><dd>{formatAmount(g.budget - g.spent)} <small>USDT0</small></dd></div></div><div><dt>Expires (UTC)</dt><dd>{new Date(Number(g.expiresAt) * 1000).toISOString().replace('.000Z', ' UTC').replace('T', ' ')} <small>· Unix {String(g.expiresAt)}</small></dd></div><div><dt>Grant ID</dt><dd>{row.id}</dd></div></dl>
          {status === 'Active' && config && <GasFunding config={config} id={row.id} grant={g} connected={connected} busy={busy || pendingFunding} onFund={fundAgent} />}
          <div className="grant-actions">{pending && <><button className="primary" disabled={!connected || busy || pendingFunding || status === 'Expired'} onClick={() => void act(row, 'approveGrant')}>Approve legacy grant</button><button disabled={!connected || busy || pendingFunding} onClick={() => void act(row, 'rejectGrant')}>Reject legacy grant</button></>}{active && <button className="danger" disabled={!connected || busy || pendingFunding} onClick={() => void act(row, 'revokeGrant')}>Revoke grant</button>}{!pending && !active && <span>No further actions</span>}</div>
        </article>;
      })}</div>
      {count > 20n && <nav className="pagination" aria-label="Grant pages"><button disabled={page === 0 || busy} onClick={() => setPage(p => p - 1)}>Newer</button><span>Page {page + 1}</span><button disabled={BigInt((page + 1) * 20) >= count || busy} onClick={() => setPage(p => p + 1)}>Older</button></nav>}
    </main><footer><span>Test-only proof of concept</span><p>Alice pays grant creation and administration fees. The agent pays payment gas.<br />Blocked payments leave funds available; submitted transactions may still cost network fees.</p></footer>
  </div>;
}
