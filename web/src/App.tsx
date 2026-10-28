import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { BaseError, createWalletClient, custom, formatUnits, type Address } from 'viem';
import {
  address,
  chain,
  CHAIN_ID,
  EXPLORER,
  identifier,
  validateConfig,
  parseAmount,
  formatAmount,
  publicClient,
  createOwnerClient,
  type OwnerOperation,
  type WalletConfig,
} from '../../shared/owner.js';
import { metaMask, type Provider } from './metamask';
import { PaymentStep } from './PaymentStep';
import { Check, ArrowUpRight, Copy, ShieldCheck, Wallet, ChevronRight } from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Card } from './components/ui/card';
import { Badge } from './components/ui/badge';
import { Alert, AlertDescription } from './components/ui/alert';
import { Textarea } from './components/ui/textarea';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from './components/ui/accordion';
import { CLI_VERSION, SKILL_URL, SKILL_PAGE_URL } from './release';
import type { ReactNode } from 'react';

function Step({
  number,
  title,
  summary,
  complete,
  children,
}: {
  number: number;
  title: string;
  summary: string;
  complete?: boolean;
  children: ReactNode;
}) {
  return (
    <AccordionItem value={String(number)} id={`step-${number}`} className="step-card">
      <AccordionTrigger className="step-trigger">
        <span className="step-number" aria-hidden="true">
          {complete ? <Check size={17} /> : number}
        </span>
        <span className="step-heading">
          <span className="step-title">{title}</span>
          <span className="step-summary">{summary}</span>
        </span>
        {complete && (
          <Badge variant="secondary" className="complete-badge">
            Complete
          </Badge>
        )}
      </AccordionTrigger>
      <AccordionContent forceMount className="step-body">
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}
const stages = [
  'Connect wallet',
  'Set up agent',
  'Approve allowance',
  'Fund transaction fees',
  'Make a payment',
];

const failure = (error: unknown) =>
  error instanceof BaseError
    ? error.shortMessage
    : error instanceof Error
      ? error.message
      : 'Request failed.';
const operationKey = (config: WalletConfig) =>
  `stable-token-allowance:v2:${config.alice.toLowerCase()}:${config.token.toLowerCase()}:operation`;
const unresolved = (op?: OwnerOperation) =>
  !!op && ['prepared', 'submitted', 'unknown'].includes(op.status);
const skillUrl = SKILL_URL;
const skillPageUrl = SKILL_PAGE_URL;
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
  const [amount, setAmount] = useState(
    new URLSearchParams(location.search).get('amount') || '0.01',
  );
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
  const [refreshing, setRefreshing] = useState(false);
  const [openSteps, setOpenSteps] = useState<string[]>(['1']);
  const pending = unresolved(operation);
  // Wallet identity is independent of network reads and signer-field validation.
  const connected = !!account && account.toLowerCase() === config?.alice.toLowerCase();
  let selectedAgent: Address | undefined;
  let agentError = '';
  if (agent.trim()) {
    try {
      selectedAgent = address(agent.trim(), 'agent address');
      if (connected && selectedAgent.toLowerCase() === account!.toLowerCase())
        throw new Error('Use your agent’s separate address, not your MetaMask wallet address.');
    } catch (e) {
      selectedAgent = undefined;
      agentError = failure(e);
    }
  }
  let amountError = '';
  try {
    parseAmount(amount);
  } catch {
    amountError = 'Enter a positive amount with at most 6 fractional digits.';
  }
  let gasError = '';
  try {
    parseAmount(gasAmount);
  } catch {
    gasError = 'Enter a positive amount with at most 6 fractional digits.';
  }
  const currentStep = !connected
    ? 1
    : !selectedAgent
      ? 2
      : allowance === undefined || allowance === 0n
        ? 3
        : gasBalance === undefined || gasBalance === 0n
          ? 4
          : 5;
  const allSteps = openSteps.length === 5;
  useEffect(() => {
    const moveFocus = !!document.activeElement?.closest('.step-card');
    setOpenSteps((previous) => (previous.length === 5 ? previous : [String(currentStep)]));
    if (!allSteps && moveFocus) {
      const frame = requestAnimationFrame(() =>
        document
          .querySelector<HTMLButtonElement>(`#step-${currentStep} [data-slot=accordion-trigger]`)
          ?.focus({ preventScroll: true }),
      );
      return () => cancelAnimationFrame(frame);
    }
  }, [currentStep]);
  const walletBlocked =
    !connected || !verified || !!networkError || !storageReady || busy || pending;
  function showStep(number: number) {
    setOpenSteps([String(number)]);
  }

  let setupPrompt = '';
  if (connected && config) {
    try {
      const budget = formatAmount(parseAmount(amount));
      const settings = validateConfig({
        ...config,
        defaultAgent: undefined,
        approvalUrl: new URL(location.pathname, location.origin).href,
      });
      setupPrompt = `Use the agent-wallet-cli skill at ${skillUrl} and follow its "Set up a signer" section.

My MetaMask owner address on Stable Testnet (chain 2201) is ${settings.alice} and my approval page is ${settings.approvalUrl}. Save these public wallet settings as a JSON file and import them with config import:
${JSON.stringify(settings)}

Create or reuse a signer, import the settings, then run allowance link --amount ${budget}. Return the signer address and the approval link requesting ${budget} USDT0 allowance that it prints. Setup is local and needs no network access.

Tell me if your storage might not persist between sessions. Stop before making any payment.`;
    } catch {
      /* An invalid allowance cannot become an instruction to the agent. */
    }
  }
  useEffect(() => {
    setPromptCopied(false);
    setPromptCopyError('');
  }, [setupPrompt]);

  useEffect(() => {
    fetch('/wallet-config.json', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok)
          throw new Error('Demo settings are unavailable. Refresh the page or try again shortly.');
        const c = validateConfig(await response.json());
        setConfig(c);
        setAgent(new URLSearchParams(location.search).get('agent') || c.defaultAgent || '');
      })
      .catch((e) => setError(failure(e)));
  }, []);
  useEffect(() => {
    setOperation(undefined);
    setRecoveredHash('');
    setStorageReady(false);
    setStorageError('');
    if (!config || !account) return;
    try {
      const saved = JSON.parse(
        localStorage.getItem(operationKey(config)) || 'null',
      ) as OwnerOperation | null;
      if (saved) {
        if (
          saved.schemaVersion !== 2 ||
          saved.chainId !== CHAIN_ID ||
          saved.alice.toLowerCase() !== config.alice.toLowerCase() ||
          saved.token.toLowerCase() !== config.token.toLowerCase() ||
          !['approve', 'fund'].includes(saved.action) ||
          !['prepared', 'submitted', 'confirmed', 'reverted', 'rejected', 'unknown'].includes(
            saved.status,
          ) ||
          !saved.intent ||
          !/^(0|[1-9]\d*)$/.test(saved.intent.amount)
        )
          throw new Error('Invalid saved operation');
        address(saved.intent.agent);
        identifier(saved.operationId);
        if (saved.hash) identifier(saved.hash);
        setOperation(saved);
        if (unresolved(saved)) setAgent(saved.intent.agent);
        if (unresolved(saved))
          setNotice(
            'A previous wallet operation is unverified. Check its confirmation before another approval or gas transfer.',
          );
      }
      setStorageReady(true);
    } catch {
      setStorageError(
        'Cannot read saved wallet operations. Restore access to browser storage before submitting.',
      );
    }
  }, [config, account]);
  const refresh = useCallback(async () => {
    if (!config || account?.toLowerCase() !== activeOwner.current) return;
    const requestId = ++refreshId.current;
    setRefreshing(true);
    try {
      const owner = createOwnerClient({
        config: { ...config, defaultAgent: undefined },
        publicClient: publicClient(config.rpcUrl),
      });
      await owner.verifyNetwork();
      if (requestId !== refreshId.current) return;
      setVerified(true);
      setNetworkError('');
      if (!account) return;
      // Invalid/partial signer input never participates in a network check.
      const [remaining, balances] = await Promise.all([
        selectedAgent ? owner.getAllowance(selectedAgent) : undefined,
        owner.getBalances(selectedAgent),
      ]);
      if (requestId !== refreshId.current) return;
      setOwnerBalance(balances.aliceToken);
      setAllowance(remaining);
      setGasBalance(balances.agentNative);
    } catch (e) {
      if (requestId !== refreshId.current) return;
      setVerified(false);
      setAllowance(undefined);
      setGasBalance(undefined);
      setOwnerBalance(undefined);
      setNetworkError(failure(e));
    } finally {
      if (requestId === refreshId.current) setRefreshing(false);
    }
  }, [config, selectedAgent, account]);
  useEffect(() => {
    setAllowance(undefined);
    setGasBalance(undefined);
    const timer = setTimeout(() => {
      void refresh();
    }, 150);
    const interval = setInterval(() => {
      void refresh();
    }, 15_000);
    return () => {
      refreshId.current++;
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [refresh]);
  useEffect(() => {
    if (!provider) return;
    const invalidate = () => {
      disconnect();
      setNotice('Wallet account or network changed. Reconnect MetaMask to continue.');
    };
    provider.on?.('accountsChanged', invalidate);
    provider.on?.('chainChanged', invalidate);
    provider.on?.('disconnect', invalidate);
    return () => {
      provider.removeListener?.('accountsChanged', invalidate);
      provider.removeListener?.('chainChanged', invalidate);
      provider.removeListener?.('disconnect', invalidate);
    };
  }, [provider]);
  function disconnect() {
    connectionId.current++;
    refreshId.current++;
    activeOwner.current = undefined;
    setAccount(undefined);
    setVerified(false);
    setOwnerBalance(undefined);
    setAllowance(undefined);
    setGasBalance(undefined);
    setOperation(undefined);
    setRecoveredHash('');
    setStorageReady(false);
    setStorageError('');
    setError('');
    setNetworkError('');
    setNotice('');
    setRefreshing(false);
  }
  function ownerActions(wallet?: ReturnType<typeof createWalletClient>) {
    const revision = connectionId.current;
    return createOwnerClient({
      config: config!,
      publicClient: publicClient(config!.rpcUrl),
      walletClient: wallet,
      onOperation: (op) => {
        localStorage.setItem(operationKey(config!), JSON.stringify(op));
        if (revision === connectionId.current && activeOwner.current === op.alice.toLowerCase())
          setOperation(op);
      },
    });
  }
  async function connect() {
    if (!config) return;
    disconnect();
    setBusy(true);
    try {
      const p = await metaMask();
      setProvider(p);
      const accounts = await p.request({ method: 'eth_requestAccounts' });
      if (!accounts[0])
        throw new Error('No account was shared. Unlock MetaMask and select an account to connect.');
      const selected = address(accounts[0], 'wallet account');
      const selectedConfig = validateConfig({ ...config, alice: selected });
      try {
        await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x899' }] });
      } catch (e) {
        if ((e as { code?: number }).code !== 4902) throw e;
        await p.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: '0x899',
              chainName: chain.name,
              nativeCurrency: chain.nativeCurrency,
              rpcUrls: [config.rpcUrl],
              blockExplorerUrls: [EXPLORER],
            },
          ],
        });
        await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x899' }] });
      }
      if (Number(await p.request({ method: 'eth_chainId' })) !== CHAIN_ID)
        throw new Error('Select Stable Testnet.');
      await createOwnerClient({
        config: selectedConfig,
        publicClient: publicClient(selectedConfig.rpcUrl),
      }).verifyNetwork();
      const currentAccounts = await p.request({ method: 'eth_accounts' });
      if (
        currentAccounts[0]?.toLowerCase() !== selected.toLowerCase() ||
        Number(await p.request({ method: 'eth_chainId' })) !== CHAIN_ID
      )
        throw new Error(
          'Wallet account or network changed while connecting. Connect MetaMask again.',
        );
      activeOwner.current = selected.toLowerCase();
      setConfig(selectedConfig);
      setAccount(selected);
      setVerified(true);
      setNotice('Owner connected. Review the agent address and allowance before approving.');
    } catch (e) {
      disconnect();
      setError(failure(e));
    } finally {
      setBusy(false);
    }
  }
  function downloadConfig() {
    if (!config || !connected) return;
    const settings = validateConfig({
      ...config,
      defaultAgent: selectedAgent,
      approvalUrl: new URL(location.pathname, location.origin).href,
    });
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(settings, null, 2) + '\n'], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'wallet-config.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function copySetupPrompt() {
    if (!setupPrompt) return;
    const revision = connectionId.current;
    try {
      await navigator.clipboard.writeText(setupPrompt);
      if (revision === connectionId.current) {
        setPromptCopied(true);
        setPromptCopyError('');
      }
    } catch {
      if (revision === connectionId.current) {
        setPromptCopied(false);
        setPromptCopyError(
          'Clipboard access is blocked. Open the setup prompt below, select the text, and copy it into your agent app.',
        );
      }
    }
  }
  async function ownerClient() {
    if (!config || !provider || !account)
      throw new Error('Connect the wallet owner in MetaMask first.');
    const accounts = await provider.request({ method: 'eth_accounts' });
    if (
      accounts[0]?.toLowerCase() !== config.alice.toLowerCase() ||
      Number(await provider.request({ method: 'eth_chainId' })) !== CHAIN_ID
    )
      throw new Error('Select the wallet owner on Stable Testnet and reconnect.');
    return ownerActions(createWalletClient({ account, chain, transport: custom(provider) }));
  }
  async function confirm(op: OwnerOperation) {
    const revision = connectionId.current;
    const result = await ownerActions().wait(op);
    if (revision !== connectionId.current || activeOwner.current !== op.alice.toLowerCase()) return;
    setNotice(
      `${op.action === 'fund' ? 'Agent gas funding' : BigInt(op.intent.amount) === 0n ? 'Allowance revocation' : 'Agent approval'} ${result.success ? 'confirmed onchain' : 'reverted'}.`,
    );
    await refresh();
  }
  async function submit(action: 'approve' | 'revoke' | 'fund') {
    if (
      !config ||
      walletBlocked ||
      !selectedAgent ||
      (action === 'approve' && amountError) ||
      (action === 'fund' && gasError)
    )
      return;
    const revision = connectionId.current;
    setBusy(true);
    setError('');
    try {
      const owner = await ownerClient();
      setNotice('Review and confirm this transaction in MetaMask. The wallet owner pays its gas.');
      const op =
        action === 'fund'
          ? await owner.fundAgentGas({ agent: selectedAgent, amount: gasAmount })
          : action === 'revoke'
            ? await owner.revoke(selectedAgent)
            : await owner.approve({ agent: selectedAgent, amount });
      if (revision === connectionId.current)
        setNotice('Submitted. Waiting for onchain confirmation…');
      await confirm(op);
    } catch (e) {
      if (revision === connectionId.current) {
        setError(failure(e));
        setNotice(
          'Check the saved operation and MetaMask history before retrying an uncertain submission.',
        );
      }
    } finally {
      setBusy(false);
    }
  }
  async function reconcile(event?: FormEvent) {
    event?.preventDefault();
    if (!operation || busy) return;
    setBusy(true);
    setError('');
    try {
      await confirm(
        operation.hash
          ? operation
          : { ...operation, hash: identifier(recoveredHash), status: 'submitted' },
      );
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="shell">
      <header className="site-header">
        <a className="brand" href="/">
          stable<span> / Agent spending</span>
        </a>
        <div className="header-links">
          <Badge variant="outline">Stable Testnet · 2201</Badge>
          <a
            href="https://github.com/stablelabs/agentic.stable.xyz"
            target="_blank"
            rel="noreferrer"
          >
            GitHub <ArrowUpRight size={14} />
          </a>
        </div>
      </header>
      <main>
        <div className="intro">
          <p className="eyebrow">A SMALL LIMIT. A REAL ONCHAIN PAYMENT.</p>
          <h1>
            Give your agent
            <br />
            <span>a spending limit.</span>
          </h1>
          <p>
            Keep your tokens in your wallet. Approve a little test USDT0,
            <br className="desktop-break" /> then ask your agent to make a payment.
          </p>
          <div className="intro-meta">
            <span>Testnet funds only</span>
            <span>Keys stay with you</span>
            <span>Revoke at any time</span>
          </div>
        </div>
        <div className="demo-layout">
          <aside className="journey-sidebar">
            <p className="eyebrow">YOUR WALKTHROUGH</p>
            <ol className="journey-nav" aria-label="Demo progress">
              {stages.map((name, index) => (
                <li key={name}>
                  <a
                    href={`#step-${index + 1}`}
                    aria-label={`${index + 1}. ${name}`}
                    aria-current={currentStep === index + 1 ? 'step' : undefined}
                    onClick={() => showStep(index + 1)}
                  >
                    <span className="nav-number" aria-hidden="true">
                      {index + 1 < currentStep ? <Check size={14} /> : index + 1}
                    </span>
                    <span>{name}</span>
                    {index + 1 === currentStep && <ChevronRight size={14} aria-hidden="true" />}
                  </a>
                </li>
              ))}
            </ol>
            <div className="sidebar-note">
              <ShieldCheck size={20} aria-hidden="true" />
              <p>
                Your wallet’s private key stays in MetaMask. Your agent holds its own separate key.
              </p>
              <a href={skillPageUrl} target="_blank" rel="noreferrer">
                Read the agent skill <ArrowUpRight size={14} />
              </a>
            </div>
          </aside>
          <div className="main-column">
            <Card className="wallet-strip" role="region" aria-label="Wallet owner">
              <div>
                <p className="eyebrow">YOUR WALLET</p>
                <p className="address">{account || 'Connect your wallet to begin'}</p>
                <p className="account-meta">
                  {connected
                    ? verified
                      ? '✓ Token network verified'
                      : 'Wallet connected · network checks unavailable'
                    : verified
                      ? '✓ Token network verified'
                      : 'Checking Stable Testnet…'}
                  {ownerBalance !== undefined
                    ? ` · ${new Intl.NumberFormat('en', { maximumFractionDigits: 6 }).format(Number(formatAmount(ownerBalance)))} USDT0 available`
                    : ''}
                </p>
              </div>
              <div className="actions">
                <Button disabled={busy || !config || connected} onClick={() => void connect()}>
                  <Wallet size={16} aria-hidden="true" />
                  {connected ? 'Owner connected' : busy ? 'Connecting…' : 'Connect MetaMask'}
                </Button>
                {account && (
                  <Button variant="ghost" disabled={busy} onClick={disconnect}>
                    Disconnect
                  </Button>
                )}
              </div>
            </Card>
            {(storageError || error || networkError) && (
              <Alert variant="destructive" className="message error">
                <AlertDescription>
                  {storageError || error || networkError}
                  {networkError && (
                    <Button
                      variant="outline"
                      disabled={busy || refreshing}
                      onClick={() => void refresh()}
                    >
                      Retry network check
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}
            {notice && (
              <div className="message" role="status">
                {notice}
              </div>
            )}
            {operation?.hash && (
              <p className="transaction">
                Latest wallet transaction:{' '}
                <a href={`${EXPLORER}/tx/${operation.hash}`} target="_blank" rel="noreferrer">
                  {operation.hash} ↗
                </a>
              </p>
            )}
            {pending && (
              <section className="message recovery" aria-label="Pending operation">
                <h2>Check your previous transaction</h2>
                <p>
                  This {operation!.action === 'fund' ? 'gas transfer' : 'token approval'} is
                  unverified. Another submission is blocked until its outcome is confirmed.
                </p>
                <p>
                  Agent: {operation!.intent.agent}
                  <br />
                  Amount:{' '}
                  {formatUnits(
                    BigInt(operation!.intent.amount),
                    operation!.action === 'fund' ? 18 : 6,
                  )}{' '}
                  {operation!.action === 'fund' ? 'native USDT0' : 'USDT0'}
                </p>
                {operation!.hash ? (
                  <Button variant="outline" disabled={busy} onClick={() => void reconcile()}>
                    Check confirmation
                  </Button>
                ) : (
                  <form onSubmit={(event) => void reconcile(event)}>
                    <label>
                      Transaction hash from MetaMask
                      <Input
                        required
                        value={recoveredHash}
                        onChange={(e) => setRecoveredHash(e.target.value)}
                        placeholder="0x…"
                      />
                    </label>
                    <Button disabled={busy} type="submit">
                      Verify transaction
                    </Button>
                    <p>
                      If MetaMask shows that nothing was submitted, retain this record and resolve
                      it before continuing. Do not send another transaction to recover an unknown
                      outcome.
                    </p>
                  </form>
                )}
              </section>
            )}
            <div className="walkthrough-heading">
              <p>
                Step {currentStep} of 5 <span>· {stages[currentStep - 1]}</span>
              </p>
              <Button
                variant="ghost"
                onClick={() =>
                  setOpenSteps(allSteps ? [String(currentStep)] : ['1', '2', '3', '4', '5'])
                }
              >
                {allSteps ? 'Focus current step' : 'Show all steps'}
              </Button>
            </div>
            <Accordion
              type="multiple"
              value={openSteps}
              onValueChange={setOpenSteps}
              className="walkthrough"
            >
              <Step
                number={1}
                title="Connect your wallet"
                summary={
                  connected
                    ? 'Your MetaMask wallet is connected.'
                    : 'Your wallet stays in your control.'
                }
                complete={connected}
              >
                <p>You’ll need three things to try the demo:</p>
                <ul className="requirements">
                  <li>
                    <strong>MetaMask</strong>
                    <span>
                      Use the browser extension or MetaMask’s mobile browser.{' '}
                      <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">
                        Get MetaMask ↗
                      </a>
                    </span>
                  </li>
                  <li>
                    <strong>Test USDT0</strong>
                    <span>
                      Get free test funds for your wallet.{' '}
                      <a href="https://faucet.stable.xyz" target="_blank" rel="noreferrer">
                        Open faucet ↗
                      </a>
                    </span>
                  </li>
                  <li>
                    <strong>An agent with terminal access</strong>
                    <span>The agent needs Node.js 22+ and persistent storage for its signer.</span>
                  </li>
                </ul>
                <p className="form-note">
                  Connect MetaMask above. We’ll switch to Stable Testnet. Connecting shares your
                  public address; approval and funding each ask for a separate confirmation.
                </p>
              </Step>
              <Step
                number={2}
                title="Set up your agent"
                summary={
                  selectedAgent
                    ? 'Agent address added. Keep its original signer.'
                    : 'Copy one prompt. Your agent returns an approval link.'
                }
                complete={!!selectedAgent}
              >
                <section aria-label="Set up your agent">
                  <p>
                    Choose a spending limit, then paste the setup prompt into your agent chat. Your
                    agent creates or reuses its own signer and returns an approval link. Open that
                    link in this browser.
                  </p>
                  <label htmlFor="allowance-amount">Allowance amount (USDT0)</label>
                  <Input
                    id="allowance-amount"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={busy || pending}
                    aria-invalid={!!amountError}
                    aria-describedby="allowance-help"
                  />
                  <p id="allowance-help" className={amountError ? 'field-error' : 'form-note'}>
                    {amountError ||
                      '0.01 USDT0 is a small limit to explore the demo. This sets a cap; it does not send a payment.'}
                  </p>
                  <div className="actions">
                    <Button disabled={!setupPrompt || busy} onClick={() => void copySetupPrompt()}>
                      <Copy size={16} aria-hidden="true" />
                      {promptCopied ? 'Setup prompt copied' : 'Copy setup prompt'}
                    </Button>
                    <a href={skillPageUrl} target="_blank" rel="noreferrer">
                      View skill ↗
                    </a>
                  </div>
                  <p className="form-note" aria-live="polite">
                    {!connected
                      ? 'Connect MetaMask above to include your wallet’s public address.'
                      : !setupPrompt
                        ? 'Enter a valid allowance amount to generate the setup prompt.'
                        : promptCopyError ||
                          (promptCopied
                            ? 'Paste into your agent chat, then open the approval link it returns.'
                            : 'Setup is local. Your agent will stop before sending a payment.')}
                  </p>
                  {setupPrompt && (
                    <details className="setup-prompt" open={promptCopyError ? true : undefined}>
                      <summary>View or manually copy setup prompt</summary>
                      <Textarea
                        aria-label="Agent setup prompt"
                        readOnly
                        value={setupPrompt}
                        rows={9}
                        onFocus={(event) => event.currentTarget.select()}
                      />
                    </details>
                  )}
                  <div className="field-divider">
                    <span>Already have an agent?</span>
                  </div>
                  <label htmlFor="agent-signer">Agent signer</label>
                  <Input
                    id="agent-signer"
                    aria-label="Agent signer"
                    value={agent}
                    onChange={(e) => {
                      setAgent(e.target.value);
                      setAllowance(undefined);
                      setGasBalance(undefined);
                    }}
                    disabled={busy || pending}
                    placeholder="Paste the agent’s 0x address"
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={!!agentError}
                    aria-describedby="agent-help"
                  />
                  <p id="agent-help" className={agentError ? 'field-error' : 'form-note'}>
                    {agentError ||
                      'Use the separate signer address returned by your agent. Never enter a private key.'}
                  </p>
                  <Button
                    variant="outline"
                    disabled={!connected || busy || !!agentError}
                    onClick={() => {
                      try {
                        downloadConfig();
                      } catch (e) {
                        setError(failure(e));
                      }
                    }}
                  >
                    Download wallet settings
                  </Button>
                  <p className="form-note">
                    Public settings only, for this wallet and signer. Your MetaMask private key
                    stays with you.
                  </p>
                </section>
              </Step>
              <Step
                number={3}
                title="Approve an allowance"
                summary={
                  allowance && allowance > 0n
                    ? `${formatAmount(allowance)} USDT0 remaining · allowance active`
                    : 'Review the limit and confirm in MetaMask.'
                }
                complete={allowance !== undefined && allowance > 0n}
              >
                <form
                  id="agent-allowance"
                  aria-label="Approve agent"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submit('approve');
                  }}
                >
                  <div className="review-grid">
                    <div>
                      <span>Agent</span>
                      <strong className="address">
                        {selectedAgent || 'Add an agent address in step 2'}
                      </strong>
                    </div>
                    <div>
                      <span>Spending limit</span>
                      <strong>
                        {amountError ? 'Choose a valid amount in step 2' : `${amount} USDT0`}
                      </strong>
                      <Button type="button" variant="link" onClick={() => showStep(2)}>
                        Change limit
                      </Button>
                    </div>
                  </div>
                  <div className="permission-note">
                    <ShieldCheck size={18} aria-hidden="true" />
                    <div>
                      <strong>What this permission allows</strong>
                      <p>
                        The agent can send up to its remaining allowance to any recipient. There is
                        no automatic expiry. Revoke the allowance to stop future spending; confirmed
                        payments cannot be undone.
                      </p>
                    </div>
                  </div>
                  <p aria-live="polite">
                    Remaining token allowance:{' '}
                    <strong>
                      {!selectedAgent
                        ? 'Enter an agent address'
                        : allowance === undefined
                          ? 'Unavailable'
                          : `${formatAmount(allowance)} USDT0`}
                    </strong>
                  </p>
                  {allowance !== undefined && allowance > 0n && (
                    <p className="form-note">
                      Your allowance is active. To change the amount, first revoke it to zero and
                      wait for confirmation, then approve the new amount.
                    </p>
                  )}
                  <div className="actions">
                    <Button
                      type="submit"
                      disabled={
                        walletBlocked ||
                        !selectedAgent ||
                        !!amountError ||
                        allowance === undefined ||
                        allowance > 0n
                      }
                    >
                      Approve agent
                    </Button>
                    <Button
                      variant="outline"
                      type="button"
                      disabled={walletBlocked || allowance === undefined || allowance === 0n}
                      onClick={() => void submit('revoke')}
                    >
                      Revoke allowance
                    </Button>
                    <Button
                      variant="ghost"
                      type="button"
                      disabled={busy || !config || refreshing}
                      onClick={() => void refresh()}
                    >
                      {refreshing ? 'Refreshing…' : 'Refresh'}
                    </Button>
                  </div>
                  <p className="form-note">
                    {!connected
                      ? 'Connect your wallet to approve an agent.'
                      : !selectedAgent
                        ? 'Add a valid, separate agent address in step 2.'
                        : 'Tokens stay in your wallet until the agent spends them. The owner pays the approval fee.'}
                  </p>
                </form>
              </Step>
              <Step
                number={4}
                title="Fund transaction fees"
                summary={
                  gasBalance !== undefined && gasBalance > 0n
                    ? 'Gas balance available. The agent checks exact fees before paying.'
                    : 'A separate balance pays your agent’s network fees.'
                }
                complete={gasBalance !== undefined && gasBalance > 0n}
              >
                <form
                  aria-label="Agent gas"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submit('fund');
                  }}
                >
                  <p>
                    Agent gas balance:{' '}
                    <strong>
                      {!selectedAgent
                        ? 'Enter an agent address'
                        : gasBalance === undefined
                          ? 'Unavailable'
                          : `${formatUnits(gasBalance, 18)} native USDT0`}
                    </strong>
                  </p>
                  <p className="form-note">
                    This separate transfer belongs to the selected agent and does not use its token
                    allowance. Revoking the allowance does not return gas funding. This top-up is
                    not a fee estimate; your agent checks the exact gas before paying.
                  </p>
                  <label htmlFor="gas-amount">Gas top-up (native USDT0)</label>
                  <Input
                    id="gas-amount"
                    inputMode="decimal"
                    value={gasAmount}
                    onChange={(e) => setGasAmount(e.target.value)}
                    disabled={busy || pending}
                    aria-invalid={!!gasError}
                    aria-describedby="gas-help"
                  />
                  <p id="gas-help" className={gasError ? 'field-error' : 'form-note'}>
                    {gasError ||
                      'Fund a small balance for network fees. This is separate from the spending limit.'}
                  </p>
                  <Button
                    type="submit"
                    disabled={
                      walletBlocked || !selectedAgent || !!gasError || allowance === undefined
                    }
                  >
                    Fund agent gas
                  </Button>
                </form>
              </Step>
              <Step
                number={5}
                title="Make a payment"
                summary="Choose the terms. Your agent signs and sends the payment."
              >
                <PaymentStep
                  config={connected ? config : undefined}
                  agent={agent}
                  allowance={allowance}
                  ownerBalance={ownerBalance}
                  gasBalance={gasBalance}
                  blocked={busy || pending || !storageReady || !verified || !!networkError}
                  blockedReason={
                    !verified || networkError
                      ? 'Network checks are unavailable. Retry the network check before preparing a payment.'
                      : undefined
                  }
                />
              </Step>
            </Accordion>
            <section className="manual-section" aria-label="Send an agent payment">
              <details>
                <summary>
                  Prefer the command line? <span>Use the agent CLI</span>
                </summary>
                <div className="manual-body">
                  <p>
                    With Node.js 22+, install the same CLI used by the setup prompt. Reuse the
                    original absolute state directory if you already have a signer. Set that
                    directory before running <code>init</code>; it keeps an existing signer.
                  </p>
                  <pre>
                    <code>{`npm install --global @stablechain/agent-wallet-cli@${CLI_VERSION}
export WALLET_STATE_DIR="$HOME/.agent-wallet-erc20"
agent-wallet init --json
agent-wallet whoami --json
agent-wallet config import --file /absolute/path/wallet-config.json --json
agent-wallet allowance show --json
agent-wallet payments prepare --recipient RECIPIENT_ADDRESS --amount 0.001 --json
agent-wallet pay --payment-id PAYMENT_ID --json`}</code>
                  </pre>
                  <p className="form-note">
                    Download public wallet settings in step 2. Replace the recipient and payment ID.
                    Preserve the same ID and signer directory if a result is uncertain.{' '}
                    <a
                      href={`https://www.npmjs.com/package/@stablechain/agent-wallet-cli/v/${CLI_VERSION}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      CLI setup and recovery guide ↗
                    </a>
                  </p>
                </div>
              </details>
            </section>
          </div>
        </div>
      </main>
      <footer>
        <p>
          Built for exploring.
          <br />
          <strong>Stable Testnet · test USDT0 only.</strong>
        </p>
        <p>
          The owner pays approval and funding fees. The agent pays payment fees.
          <br />
          Token allowances have no recipient restriction or automatic expiry.
        </p>
      </footer>
    </div>
  );
}
