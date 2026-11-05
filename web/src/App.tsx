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
import { addStableTestnet, metaMask, STABLE_TESTNET_HEX, type Provider } from './metamask';
import { PaymentStep } from './PaymentStep';
import {
  Check,
  ArrowUpRight,
  Copy,
  ShieldCheck,
  Wallet,
  ChevronRight,
  ChevronDown,
  X,
} from 'lucide-react';
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
  current,
  children,
}: {
  number: number;
  title: string;
  summary: string;
  complete?: boolean;
  current?: boolean;
  children: ReactNode;
}) {
  return (
    <AccordionItem
      value={String(number)}
      id={`step-${number}`}
      className="step-card"
      data-current={current ? 'true' : undefined}
    >
      <AccordionTrigger className="step-trigger">
        <span className="step-number" aria-hidden="true">
          {complete ? <Check size={17} /> : number}
        </span>
        <span className="step-heading">
          <span className="step-title">{title}</span>
          <span className="step-summary">{summary}</span>
        </span>
        {complete && (
          <Badge variant="outline" className="complete-badge">
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
  'Configure signer',
  'Approve allowance',
  'Fund gas',
  'Send payment',
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
const MAIN_SITE_URL = 'https://stable.xyz/';
const DOCS_URL = 'https://docs.stable.xyz/';
const GITHUB_URL = 'https://github.com/stablelabs/agentic.stable.xyz';
const FAUCET_URL = 'https://faucet.stable.xyz/';
const CLI_COMMANDS = [
  `npm install --global @stablechain/agent-wallet-cli@${CLI_VERSION}`,
  'export WALLET_STATE_DIR="$HOME/.agent-wallet-erc20"',
  'agent-wallet init --json',
  'agent-wallet whoami --json',
  'agent-wallet config import --file /absolute/path/wallet-config.json --json',
  'agent-wallet allowance show --json',
  'agent-wallet payments prepare --recipient RECIPIENT_ADDRESS --amount 0.001 --json',
  'agent-wallet pay --payment-id PAYMENT_ID --json',
];
// Set only by the Disconnect button, so a reload or a new tab does not silently reconnect.
const DISCONNECTED_KEY = 'agentic-stable-demo:disconnected';
function rememberDisconnected(value: boolean) {
  try {
    if (value) localStorage.setItem(DISCONNECTED_KEY, '1');
    else localStorage.removeItem(DISCONNECTED_KEY);
  } catch {
    /* Storage blocked: the visitor can still connect manually. */
  }
}
function wasDisconnected() {
  try {
    return localStorage.getItem(DISCONNECTED_KEY) === '1';
  } catch {
    return false;
  }
}
const formatBalance = (value: bigint) =>
  new Intl.NumberFormat('en', { maximumFractionDigits: 6 }).format(Number(formatAmount(value)));
type NetworkRequest =
  | { state: 'idle' }
  | { state: 'pending' | 'added' | 'failed'; message: string };
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
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState('');
  const [networkError, setNetworkError] = useState('');
  const [notice, setNotice] = useState('');
  const [operation, setOperation] = useState<OwnerOperation>();
  const [recoveredHash, setRecoveredHash] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);
  const [promptCopyError, setPromptCopyError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [openSteps, setOpenSteps] = useState<string[]>(['1']);
  const [selectedStep, setSelectedStep] = useState(1);
  const [networkRequest, setNetworkRequest] = useState<NetworkRequest>({ state: 'idle' });
  const networkRequestId = useRef(0);
  const addNetworkInFlight = useRef<Promise<void> | undefined>(undefined);
  const networkButton = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const walletCardRef = useRef<HTMLDivElement>(null);
  const pending = unresolved(operation);
  // Wallet identity is independent of network reads and signer-field validation.
  const connected = !!account && account.toLowerCase() === config?.alice.toLowerCase();
  let selectedAgent: Address | undefined;
  let agentError = '';
  if (agent.trim()) {
    try {
      selectedAgent = address(agent.trim(), 'agent address');
      if (connected && selectedAgent.toLowerCase() === account!.toLowerCase())
        throw new Error('Agent and owner addresses must differ.');
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
    setSelectedStep(currentStep);
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
    setSelectedStep(number);
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
    const sidebar = sidebarRef.current;
    const card = walletCardRef.current;
    if (!sidebar || !card || typeof ResizeObserver === 'undefined') return;
    const sync = () => sidebar.style.setProperty('--wallet-card-height', `${card.offsetHeight}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(card);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    fetch('/wallet-config.json', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Settings unavailable. Reload to retry.');
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
          setNotice('Unverified wallet transaction. Resolve it before submitting another.');
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
      setNotice('Wallet account or network changed. Reconnect MetaMask.');
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
  // silent: restore a connection MetaMask already allows for this site (a reload, or an agent's
  // approval link opened in a new tab). No prompt, no network switch, no error if it can't.
  async function connect({ silent = false }: { silent?: boolean } = {}) {
    if (!config) return;
    disconnect();
    setBusy(true);
    setRestoring(silent);
    try {
      // Let an open Add Stable Testnet request finish first, so MetaMask shows one prompt at a time.
      await addNetworkInFlight.current?.catch(() => undefined);
      const p = await metaMask();
      if (!silent) setProvider(p);
      const accounts = silent
        ? await p.request({ method: 'eth_accounts' })
        : await p.request({ method: 'eth_requestAccounts' });
      if (!accounts[0]) {
        if (silent) return;
        throw new Error('No account was shared. Unlock MetaMask and select an account to connect.');
      }
      const selected = address(accounts[0], 'wallet account');
      const selectedConfig = validateConfig({ ...config, alice: selected });
      if (silent) {
        // Switching networks needs the visitor's click.
        if (Number(await p.request({ method: 'eth_chainId' })) !== CHAIN_ID) return;
      } else {
        try {
          await p.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: STABLE_TESTNET_HEX }],
          });
        } catch (e) {
          if ((e as { code?: number }).code !== 4902) throw e;
          await addNetworkOnce(() => p, config.rpcUrl);
          await p.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: STABLE_TESTNET_HEX }],
          });
        }
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
      if (silent) setProvider(p);
      else rememberDisconnected(false);
      activeOwner.current = selected.toLowerCase();
      setConfig(selectedConfig);
      setAccount(selected);
      setVerified(true);
      setNotice('');
      setNetworkRequest((request) => (request.state === 'failed' ? { state: 'idle' } : request));
    } catch (e) {
      disconnect();
      if (!silent) setError(failure(e));
    } finally {
      setBusy(false);
      setRestoring(false);
    }
  }
  // Restore the wallet once settings load, unless the visitor chose Disconnect.
  const restoreAttempted = useRef(false);
  useEffect(() => {
    if (!config || restoreAttempted.current) return;
    restoreAttempted.current = true;
    if (!wasDisconnected()) void connect({ silent: true });
  }, [config]);
  // One add-network request at a time, shared by the header action and connect().
  function addNetworkOnce(provider: () => Provider | Promise<Provider>, rpcUrl?: string) {
    addNetworkInFlight.current ??= Promise.resolve()
      .then(provider)
      .then((wallet) => addStableTestnet(wallet, rpcUrl))
      .finally(() => {
        addNetworkInFlight.current = undefined;
      });
    return addNetworkInFlight.current;
  }
  // Adds the network only: no account access, no chain switch request, no transaction.
  // Repeated clicks join the request MetaMask is already showing instead of opening another.
  async function addNetwork() {
    if (busy) return;
    const requestId = ++networkRequestId.current;
    setNetworkRequest({ state: 'pending', message: 'Confirm Stable Testnet in MetaMask.' });
    try {
      await addNetworkOnce(metaMask, config?.rpcUrl);
      if (requestId === networkRequestId.current)
        setNetworkRequest({
          state: 'added',
          message: 'MetaMask accepted Stable Testnet (chain 2201).',
        });
    } catch (e) {
      const code = (e as { code?: number }).code;
      if (requestId === networkRequestId.current)
        setNetworkRequest({
          state: 'failed',
          message:
            code === 4001
              ? 'The request was rejected in MetaMask. Stable Testnet was not added.'
              : code === -32002
                ? 'MetaMask already has a request open. Finish it in MetaMask, then try again.'
                : failure(e),
        });
    }
  }
  function returnFocusFromToast() {
    // preventScroll: on phones the header is not sticky, so a plain focus() would jump to the top.
    if (document.activeElement?.closest('.toast'))
      networkButton.current?.focus({ preventScroll: true });
  }
  function dismissNetworkRequest() {
    returnFocusFromToast();
    networkRequestId.current++;
    setNetworkRequest({ state: 'idle' });
  }
  useEffect(() => {
    if (networkRequest.state === 'idle') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissNetworkRequest();
    };
    document.addEventListener('keydown', onKey);
    const timer =
      networkRequest.state === 'added' ? setTimeout(dismissNetworkRequest, 8000) : undefined;
    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(timer);
    };
  }, [networkRequest]);
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
        setPromptCopyError('Clipboard access is blocked. Copy the prompt below.');
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
      setNotice('Confirm in MetaMask. Owner pays gas.');
      const op =
        action === 'fund'
          ? await owner.fundAgentGas({ agent: selectedAgent, amount: gasAmount })
          : action === 'revoke'
            ? await owner.revoke(selectedAgent)
            : await owner.approve({ agent: selectedAgent, amount });
      if (revision === connectionId.current) setNotice('Submitted. Awaiting confirmation…');
      await confirm(op);
    } catch (e) {
      if (revision === connectionId.current) {
        setError(failure(e));
        setNotice('Check the saved transaction and MetaMask history before retrying.');
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
  // Moves to the wallet messages in the sidebar and focuses the first control there.
  function showWalletMessages() {
    const panel = document.getElementById('wallet-messages');
    if (!panel) return;
    panel.scrollIntoView({ block: 'nearest' });
    (
      panel.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)') ?? panel
    ).focus({ preventScroll: true });
  }
  // The wallet steps repeat the latest wallet message, so a blocked form always says why.
  const walletMessage = storageError || error || networkError;
  const stepStatus =
    connected && (pending || walletMessage || notice) ? (
      <div
        className={pending || walletMessage ? 'step-status attention' : 'step-status'}
      >
        {pending && (
          <p>
            <strong>
              {operation!.action === 'fund' ? 'Gas transfer' : 'Token approval'} unverified.
            </strong>{' '}
            New wallet submissions are blocked until it is confirmed.
          </p>
        )}
        {walletMessage && <p className="step-status-error">{walletMessage}</p>}
        {notice && !pending && <p>{notice}</p>}
        {(pending || walletMessage) && (
          <Button type="button" variant="link" onClick={showWalletMessages}>
            {pending ? 'Resolve unverified transaction' : 'View details'}
          </Button>
        )}
      </div>
    ) : null;
  const walletStatus = connected
    ? verified
      ? '✓ Token network verified'
      : 'Wallet connected · network checks unavailable'
    : verified
      ? '✓ Token network verified'
      : 'Checking Stable Testnet…';
  return (
    <div className="shell">
      <header className="site-header">
        <div className="nav-row">
          <a className="brand" href={MAIN_SITE_URL}>
            <img src="/brand/stable-wordmark-light.svg" alt="Stable" width={93} height={24} />
          </a>
          <nav className="header-links" aria-label="Resources">
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              GitHub <ArrowUpRight size={14} aria-hidden="true" />
            </a>
            <a href={DOCS_URL} target="_blank" rel="noreferrer">
              Docs <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </nav>
          <Button
            ref={networkButton}
            variant="outline"
            disabled={busy}
            className="network-button"
            aria-describedby="network-button-help"
            onClick={() => void addNetwork()}
          >
            Add Stable Testnet to wallet
          </Button>
          <span id="network-button-help" hidden>
            Adds chain 2201 to MetaMask. Does not connect an account or send a transaction.
          </span>
        </div>
      </header>
      <div className="demo-layout">
        <section className="intro" aria-labelledby="intro-title">
          <p className="eyebrow">Stable Testnet demo</p>
          <h1 id="intro-title">Agent payments</h1>
          <p className="lede">
            This demo lets an AI agent pay in USDT0 on Stable Testnet. You connect MetaMask,
            give an agent a USDT0 allowance, fund its gas, then hand off a test payment for the
            agent to send.
          </p>
          <p>
            The payment is an ERC-20 <code>transferFrom</code> from your wallet, capped by the
            allowance, so your USDT0 stays with you until the agent pays. The agent signs with
            the agent-wallet CLI and keeps its key on its own machine. Approval and gas funding
            are separate MetaMask transactions. This page never sends the payment; the agent
            does, and returns a receipt you can check on StableScan.
          </p>
          <p className="intro-needs">
            You need MetaMask, test USDT0 and an agent that can run Node.js 22+ with persistent
            storage.
          </p>
          <div className="intro-actions">
            <Button asChild variant="outline">
              <a href={FAUCET_URL} target="_blank" rel="noreferrer">
                Get test USDT0 <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            </Button>
          </div>
        </section>
        <aside ref={sidebarRef} className="sidebar" aria-label="Wallet and resources">
          <Card
            ref={walletCardRef}
            className="wallet-card"
            role="region"
            aria-label="Wallet owner"
          >
            <div className="wallet-card-head">
              <p className="eyebrow">Wallet owner</p>
              <span
                className={connected && verified ? 'status-dot online' : 'status-dot'}
                aria-hidden="true"
              />
            </div>
            <p className="address">{account || 'Not connected'}</p>
            {connected && (
              <p className="owner-balance" aria-live="polite">
                {ownerBalance !== undefined ? (
                  <>
                    <span className="balance-amount">{formatBalance(ownerBalance)}</span>{' '}
                    <span className="balance-unit">USDT0 available</span>
                  </>
                ) : (
                  <span className="balance-unit">
                    {networkError ? 'Balance unavailable' : 'Checking balance…'}
                  </span>
                )}
              </p>
            )}
            <p className={verified ? 'account-meta verified' : 'account-meta'}>{walletStatus}</p>
            <div className="actions wallet-actions">
              <Button disabled={busy || !config || connected} onClick={() => void connect()}>
                <Wallet size={16} aria-hidden="true" />
                {connected
                  ? 'Owner connected'
                  : busy
                    ? restoring
                      ? 'Checking MetaMask…'
                      : 'Connecting…'
                    : 'Connect MetaMask'}
              </Button>
              {account && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    rememberDisconnected(true);
                    disconnect();
                  }}
                >
                  Disconnect
                </Button>
              )}
            </div>
          </Card>
          {(storageError || error || networkError || notice || operation?.hash || pending) && (
            <div className="sidebar-messages" id="wallet-messages" tabIndex={-1}>
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
                  Transaction:{' '}
                  <a href={`${EXPLORER}/tx/${operation.hash}`} target="_blank" rel="noreferrer">
                    {operation.hash} <ArrowUpRight size={12} aria-hidden="true" />
                  </a>
                </p>
              )}
              {pending && (
                <section className="message recovery" aria-label="Pending operation">
                  <h2>Unverified transaction</h2>
                  <p>
                    {operation!.action === 'fund' ? 'Gas transfer' : 'Token approval'} unverified.
                    New submissions blocked until confirmed.
                  </p>
                  <p>
                    Agent: <span className="address">{operation!.intent.agent}</span>
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
                        Keep this record. Check MetaMask history; do not submit a replacement
                        transaction while the outcome is unknown.
                      </p>
                    </form>
                  )}
                </section>
              )}
            </div>
          )}
          <div className="journey">
            <p className="eyebrow">Steps</p>
            <ol className="journey-nav" aria-label="Demo progress">
              {stages.map((name, index) => (
                <li key={name}>
                  <a
                    href={`#step-${index + 1}`}
                    aria-label={`${index + 1}. ${name}`}
                    aria-current={selectedStep === index + 1 ? 'step' : undefined}
                    onClick={() => showStep(index + 1)}
                  >
                    <span className="nav-number" aria-hidden="true">
                      {index + 1 < currentStep ? <Check size={14} /> : index + 1}
                    </span>
                    <span>{name}</span>
                    {index + 1 === selectedStep && <ChevronRight size={14} aria-hidden="true" />}
                  </a>
                </li>
              ))}
            </ol>
          </div>
          <ul className="resource-links" aria-label="Agent and explorer">
            <li>
              <a href={skillPageUrl} target="_blank" rel="noreferrer">
                Agent skill <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            </li>
            <li>
              <a href={EXPLORER} target="_blank" rel="noreferrer">
                StableScan Testnet <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            </li>
          </ul>
          <section className="cli-panel" aria-label="CLI">
            <details
              onToggle={(event) => {
                if (event.currentTarget.open)
                  event.currentTarget.scrollIntoView({ block: 'nearest' });
              }}
            >
              <summary>
                <span>CLI</span>
                <span className="cli-version">v{CLI_VERSION}</span>
                <ChevronDown size={14} aria-hidden="true" />
              </summary>
              <div className="manual-body">
                <p>Node.js 22+. Reuse the signer’s original absolute state directory.</p>
                <pre>
                  <code>
                    {CLI_COMMANDS.map((command) => (
                      <span className="cli-line" key={command}>
                        {command}
                      </span>
                    ))}
                  </code>
                </pre>
                <p className="form-note">
                  Download settings in step 2. Replace recipient and payment ID. Recover uncertain
                  payments with the same ID and signer directory.{' '}
                  <a
                    href={`https://www.npmjs.com/package/@stablechain/agent-wallet-cli/v/${CLI_VERSION}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    CLI reference <ArrowUpRight size={14} aria-hidden="true" />
                  </a>
                </p>
              </div>
            </details>
          </section>
        </aside>
        <main className="main-column">
          <div className="walkthrough-toolbar">
            <p className="eyebrow">Walkthrough</p>
            <Button
              variant="ghost"
              onClick={() =>
                setOpenSteps(allSteps ? [String(selectedStep)] : ['1', '2', '3', '4', '5'])
              }
            >
              {allSteps ? 'Focus current step' : 'Show all steps'}
            </Button>
          </div>
          <Accordion
            type="multiple"
            value={openSteps}
            onValueChange={(steps) => {
              const opened = steps.find((step) => !openSteps.includes(step));
              if (opened) setSelectedStep(Number(opened));
              setOpenSteps(steps);
            }}
            className="walkthrough"
          >
            <Step
              number={1}
              current={selectedStep === 1}
              title="Connect wallet"
              summary={connected ? 'Connected' : 'MetaMask · chain 2201'}
              complete={connected}
            >
              <ul className="requirements">
                <li>
                  <strong>MetaMask</strong>
                  <span>
                    Extension or mobile browser.{' '}
                    <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">
                      Install <ArrowUpRight size={14} aria-hidden="true" />
                    </a>
                  </span>
                </li>
                <li>
                  <strong>Stable Testnet</strong>
                  <span>
                    Chain 2201. Connecting adds it if MetaMask does not have it, or use Add Stable
                    Testnet to wallet at the top of the page.
                  </span>
                </li>
                <li>
                  <strong>Test USDT0</strong>
                  <span>
                    Funds the test payment and gas.{' '}
                    <a href={FAUCET_URL} target="_blank" rel="noreferrer">
                      Faucet <ArrowUpRight size={14} aria-hidden="true" />
                    </a>
                  </span>
                </li>
                <li>
                  <strong>Agent</strong>
                  <span>Terminal, Node.js 22+, persistent signer storage.</span>
                </li>
              </ul>
              <p className="form-note">
                Use Connect MetaMask in the wallet panel. Connection shares your address only.
                MetaMask confirms approvals and funding separately.
              </p>
            </Step>
            <Step
              number={2}
              current={selectedStep === 2}
              title="Configure signer"
              summary={selectedAgent ? 'Address set' : 'Local CLI · Node.js 22+'}
              complete={!!selectedAgent}
            >
              <section aria-label="Configure signer">
                <p>
                  Paste the setup prompt into your agent chat. Open the returned approval link here.
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
                  {amountError}
                </p>
                <div className="actions">
                  <Button disabled={!setupPrompt || busy} onClick={() => void copySetupPrompt()}>
                    <Copy size={16} aria-hidden="true" />
                    {promptCopied ? 'Setup prompt copied' : 'Copy setup prompt'}
                  </Button>
                  <a href={skillPageUrl} target="_blank" rel="noreferrer">
                    View skill <ArrowUpRight size={14} aria-hidden="true" />
                  </a>
                </div>
                <p className="form-note" aria-live="polite">
                  {!connected
                    ? 'Connect MetaMask.'
                    : !setupPrompt
                      ? 'Enter a valid allowance amount.'
                      : promptCopyError ||
                        (promptCopied
                          ? 'Paste in your agent chat; open its approval link.'
                          : 'Setup does not send payments.')}
                </p>
                {setupPrompt && (
                  <details className="setup-prompt" open={promptCopyError ? true : undefined}>
                    <summary>Setup prompt</summary>
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
                  <span>Existing signer</span>
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
                  placeholder="0x…"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!!agentError}
                  aria-describedby="agent-help"
                />
                <p id="agent-help" className={agentError ? 'field-error' : 'form-note'}>
                  {agentError || 'Signer address only. Keep the private key local.'}
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
                <p className="form-note">Public owner, token, RPC and signer settings.</p>
              </section>
            </Step>
            <Step
              number={3}
              current={selectedStep === 3}
              title="Approve allowance"
              summary={
                allowance && allowance > 0n
                  ? `${formatAmount(allowance)} USDT0 remaining`
                  : 'ERC-20 approve'
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
                    <strong>Allowance scope</strong>
                    <p>
                      Any recipient. No expiry. Revocation applies after confirmation; completed
                      transfers are final.
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
                    To change a nonzero allowance: revoke, wait for confirmation, then approve
                    again.
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
                {stepStatus}
                <p className="form-note">
                  {!connected
                    ? 'Connect MetaMask.'
                    : !selectedAgent
                      ? 'Set the signer in step 2.'
                      : 'Approval leaves tokens in the owner wallet. Owner pays gas.'}
                </p>
              </form>
            </Step>
            <Step
              number={4}
              current={selectedStep === 4}
              title="Fund gas"
              summary={
                gasBalance !== undefined && gasBalance > 0n
                  ? `${formatUnits(gasBalance, 18)} native USDT0`
                  : 'Native USDT0'
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
                  Native USDT0 for the agent’s fees, outside its token allowance. Revocation does
                  not return this balance.
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
                  {gasError || 'Manual top-up, not a fee estimate.'}
                </p>
                <Button
                  type="submit"
                  disabled={
                    walletBlocked || !selectedAgent || !!gasError || allowance === undefined
                  }
                >
                  Fund agent gas
                </Button>
                {stepStatus}
              </form>
            </Step>
            <Step
              number={5}
              current={selectedStep === 5}
              title="Send payment"
              summary="Agent-signed transferFrom"
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
                    ? 'Network check failed. Retry before preparing a payment.'
                    : undefined
                }
              />
            </Step>
          </Accordion>
        </main>
        <footer className="site-footer">
          <p>Test USDT0 only. Testnet demo; unaudited.</p>
          <p>
            <a href={MAIN_SITE_URL}>stable.xyz</a>
          </p>
        </footer>
      </div>
      {networkRequest.state !== 'idle' && (
        <div
          className={`toast toast-${networkRequest.state}`}
          role={networkRequest.state === 'failed' ? 'alert' : 'status'}
          aria-label="Add Stable Testnet"
        >
          <div className="toast-head">
            {networkRequest.state === 'pending' && (
              <span className="toast-spinner" aria-hidden="true" />
            )}
            <p className="toast-title">
              {networkRequest.state === 'pending'
                ? 'Waiting for MetaMask'
                : networkRequest.state === 'added'
                  ? 'Stable Testnet ready'
                  : 'Stable Testnet not added'}
            </p>
            <button
              type="button"
              className="toast-close"
              aria-label="Dismiss"
              onClick={dismissNetworkRequest}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <p className="toast-text">{networkRequest.message}</p>
          {networkRequest.state === 'failed' && (
            <button
              type="button"
              className="toast-action"
              disabled={busy}
              onClick={() => {
                returnFocusFromToast();
                void addNetwork();
              }}
            >
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
