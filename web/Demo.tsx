import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  Circle,
  CircleAlert,
  Download,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import {
  formatMoney as formatExactMoney,
  network,
  sampleInput,
  type Money,
  type Quote,
  type Run,
  type Session,
} from '../shared/contracts';
import { api, ApiError } from './api';
import { Invoice } from './App';
import { track } from './telemetry';
const labels: Record<string, string> = {
  queued: 'Checking purchase permissions',
  authorizing: 'Checking purchase permissions',
  submitted: 'Payment submitted',
  confirming: 'Waiting for confirmation',
  settled: 'Payment settled',
  delivering: 'Retrieving result',
  completed: 'Invoice extracted',
  blocked: 'Purchase blocked',
  failed: 'Payment failed',
  payment_unknown: 'Checking payment status',
  delivery_failed: 'Payment settled; delivery needs another attempt',
};
const done = ['completed', 'blocked', 'failed', 'delivery_failed'];
type Intent = { key: string; quoteId: string; runId?: string };
function readIntent(): Intent | null {
  try {
    return JSON.parse(localStorage.getItem('agentic:intent') || 'null');
  } catch {
    return null;
  }
}
export default function Demo({ onGuide }: { onGuide: () => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(true);
  const [clock, setClock] = useState(Date.now());
  const [json, setJson] = useState(false);
  const [fixture, setFixture] = useState(false);
  const alive = useRef(true);
  const locked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retryDelay = useRef(2000);
  const quoteExpired = !!quote && Date.parse(quote.expiresAt) <= clock;
  const formatMoney = (value: Money) =>
    formatExactMoney(
      value,
      run?.receipt?.asset.decimals ?? session?.asset.decimals ?? quote?.asset.decimals,
    );
  function accept(r: Run) {
    if (!alive.current) return;
    setRun(r);
    setSession(r.session);
    setError(null);
    if (r.receipt) track('payment_settled', { id: r.id }, true);
    if (r.status === 'completed') track('result_delivered', { id: r.id }, true);
  }
  function report(e: unknown) {
    if (alive.current) {
      const err =
        e instanceof ApiError
          ? e
          : new ApiError('SERVICE_UNAVAILABLE', 'The demo is temporarily unavailable.');
      setError(err);
      track('demo_error', { code: err.code });
    }
  }
  function poll(id: string) {
    clearTimeout(timer.current);
    if (!alive.current) return;
    timer.current = setTimeout(async () => {
      try {
        const r = await api<Run>(`/runs/${id}`);
        accept(r);
        retryDelay.current = 2000;
        if (!done.includes(r.status)) poll(id);
      } catch (e) {
        report(e);
        if (e instanceof ApiError && e.code === 'SESSION_EXPIRED') return;
        retryDelay.current = Math.min(
          30_000,
          Math.max(retryDelay.current * 2, e instanceof ApiError ? e.retryAfter : 2000),
        );
        poll(id);
      }
    }, retryDelay.current);
  }
  async function getQuote() {
    setBusy(true);
    setError(null);
    try {
      const q = await api<Quote>('/quotes', sampleInput);
      if (alive.current) {
        setQuote(q);
        track('quote_viewed', { id: q.id }, true);
      }
    } catch (e) {
      report(e);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function recoverIntent(intent: Intent) {
    const r = intent.runId
      ? await api<Run>(`/runs/${intent.runId}`)
      : await api<Run>('/runs', { quoteId: intent.quoteId }, intent.key);
    localStorage.setItem('agentic:intent', JSON.stringify({ ...intent, runId: r.id }));
    accept(r);
    if (!done.includes(r.status)) poll(r.id);
  }
  async function prepare() {
    setBusy(true);
    setError(null);
    try {
      const capabilities = await api<{ environment: string; services: { available: boolean }[] }>(
        '/capabilities',
      );
      const preview = import.meta.env.DEV && capabilities.environment === 'fixture';
      if (capabilities.environment !== 'testnet' && !preview)
        throw new ApiError('UNSUPPORTED_NETWORK', 'This demo requires Stable Testnet.');
      if (alive.current) setFixture(preview);
      let s: Session;
      try {
        s = await api<Session>('/session');
      } catch (e) {
        if (!(e instanceof ApiError) || e.code !== 'SESSION_EXPIRED') throw e;
        if (readIntent()) throw e;
        if (!capabilities.services[0]?.available)
          throw new ApiError(
            'FUNDING_UNAVAILABLE',
            'The testnet demo is temporarily unavailable. You can still explore the developer guides.',
          );
        let key = localStorage.getItem('agentic:session-key');
        if (!key) {
          key = crypto.randomUUID();
          localStorage.setItem('agentic:session-key', key);
        }
        s = await api<Session>('/sessions', {}, key);
      }
      if (!alive.current) return;
      setSession(s);
      if (s.status === 'funding') {
        timer.current = setTimeout(() => void prepare(), 2000);
        return;
      }
      if (s.status !== 'ready')
        throw new ApiError('FUNDING_UNAVAILABLE', 'Your testnet wallet is unavailable.');
      track('session_ready', { id: s.id }, true);
      const intent = readIntent();
      if (s.activeRunId) {
        const r = await api<Run>(`/runs/${s.activeRunId}`);
        accept(r);
        if (!done.includes(r.status)) poll(r.id);
      } else if (intent) await recoverIntent(intent);
      else await getQuote();
    } catch (e) {
      report(e);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void prepare();
    const interval = setInterval(() => setClock(Date.now()), 1000);
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
      clearInterval(interval);
    };
  }, []);
  async function buy() {
    if (locked.current || !quote || quoteExpired) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    const intent = readIntent() || { key: crypto.randomUUID(), quoteId: quote.id };
    localStorage.setItem('agentic:intent', JSON.stringify(intent));
    try {
      await recoverIntent(intent);
      track('run_started', { id: intent.key }, true);
    } catch (e) {
      if (
        e instanceof ApiError &&
        [
          'QUOTE_EXPIRED',
          'QUOTE_CHANGED',
          'QUOTE_USED',
          'BUDGET_EXCEEDED',
          'INSUFFICIENT_FUNDS',
        ].includes(e.code)
      ) {
        localStorage.removeItem('agentic:intent');
        setQuote(null);
      }
      report(e);
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function resume() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      if (run) {
        const r = await api<Run>(`/runs/${run.id}/resume`, {}, crypto.randomUUID());
        accept(r);
        poll(r.id);
      } else if (readIntent()) await recoverIntent(readIntent()!);
      else await prepare();
    } catch (e) {
      report(e);
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function download() {
    if (!run?.result) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(run.result, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'invoice-extraction.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const canNew = run && ['blocked', 'failed', 'completed'].includes(run.status);
  return (
    <>
      <h2 id="panel-title">{run ? labels[run.status] : 'Let an agent handle the invoice.'}</h2>
      <p className="panel-lede">
        Extract the vendor, line items, and total from this sample invoice.
      </p>
      <div className="demo-meta">
        <span className="badge">Stable Testnet</span>
        <span>Sample agent workflow</span>
      </div>
      {fixture && <p className="notice">Preview — no payment is sent</p>}
      <div role="status" aria-live="polite" className="status-line">
        {session?.status === 'funding'
          ? 'Preparing your testnet wallet'
          : busy && !run
            ? 'Preparing the testnet demo...'
            : run
              ? labels[run.status]
              : session
                ? 'Ready when you are.'
                : ''}
      </div>
      {error && (
        <div className="notice" role="alert">
          <strong>{error.code === 'SESSION_EXPIRED' ? 'Session expired' : 'Demo status'}</strong>
          <p>{error.message}</p>
          {error.code === 'SESSION_EXPIRED' ? (
            <button
              className="text-button"
              onClick={() => {
                localStorage.removeItem('agentic:intent');
                localStorage.removeItem('agentic:session-key');
                setRun(null);
                setQuote(null);
                void prepare();
              }}
            >
              Start a new session <ArrowRight size={16} />
            </button>
          ) : (
            <button className="text-button" disabled={busy} onClick={() => void resume()}>
              Check again <RefreshCw size={16} />
            </button>
          )}
        </div>
      )}
      {!run && <Invoice />}
      {session && (
        <div className="budget">
          <span>
            Demo budget<strong>{formatMoney(session.budget.limit)} USDT0</strong>
          </span>
          <span>
            Remaining<strong>{formatMoney(session.budget.remaining)} USDT0</strong>
          </span>
          <span>
            Reserved<strong>{formatMoney(session.budget.reserved)} USDT0</strong>
          </span>
        </div>
      )}
      {!run && quote && (
        <>
          <dl className="quote">
            <div>
              <dt>Extraction price</dt>
              <dd>{formatMoney(quote.price)} USDT0</dd>
            </div>
            <div>
              <dt>Maximum network fee</dt>
              <dd>{formatMoney(quote.maxNetworkFee)} USDT0</dd>
            </div>
            <div className="quote-total">
              <dt>Maximum total</dt>
              <dd>{formatMoney(quote.maxTotal)} USDT0</dd>
            </div>
          </dl>
          <p className="muted">
            {quoteExpired
              ? 'Quote expired. Review a fresh price before purchasing.'
              : `Quote expires at ${new Date(quote.expiresAt).toLocaleTimeString()}.`}
          </p>
          {quoteExpired ? (
            <button className="secondary" disabled={busy} onClick={() => void getQuote()}>
              Refresh quote <RefreshCw size={16} />
            </button>
          ) : (
            <button
              className="primary"
              disabled={busy || !!readIntent()}
              onClick={() => void buy()}
            >
              Run the demo <ArrowRight size={18} />
            </button>
          )}
        </>
      )}
      {!run && !quote && session?.status === 'ready' && !readIntent() && (
        <button className="secondary" disabled={busy} onClick={() => void getQuote()}>
          Request quote <RefreshCw size={16} />
        </button>
      )}
      {run && (
        <>
          <ol className="events">
            {run.events.map((e) => (
              <li key={e.seq}>
                {['settled', 'completed'].includes(e.status) ? (
                  <Check className="event-success" size={15} />
                ) : ['blocked', 'failed', 'payment_unknown', 'delivery_failed'].includes(
                    e.status,
                  ) ? (
                  <CircleAlert className="event-problem" size={15} />
                ) : (
                  <Circle size={15} />
                )}
                <span>{e.message}</span>
              </li>
            ))}
          </ol>
          {run.error && <p className="notice">{run.error.message}</p>}
          {['payment_unknown', 'delivery_failed'].includes(run.status) && (
            <button className="secondary" disabled={busy} onClick={() => void resume()}>
              Resume this purchase <RefreshCw size={16} />
            </button>
          )}
        </>
      )}
      {run?.result && (
        <section className="result" aria-label="Delivered invoice result">
          <div className="result-heading">
            <h3>{run.result.vendor}</h3>
            <div className="result-actions">
              <button className="text-button" onClick={() => setJson(!json)}>
                {json ? 'Table' : 'JSON'}
              </button>
              <button
                className="icon-button"
                title="Download JSON"
                aria-label="Download JSON"
                onClick={download}
              >
                <Download size={18} />
              </button>
            </div>
          </div>
          {json ? (
            <pre className="json">{JSON.stringify(run.result, null, 2)}</pre>
          ) : (
            <>
              <p>
                {run.result.invoiceNumber} · {run.result.currency}
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Line item</th>
                      <th>Qty</th>
                      <th>Unit price</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.result.lineItems.map((item, i) => (
                      <tr key={i}>
                        <td>{item.description}</td>
                        <td>{item.quantity}</td>
                        <td>{item.unitPrice}</td>
                        <td>{item.total}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={3}>Invoice total (USD)</th>
                      <td>{run.result.total}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </section>
      )}
      {run?.receipt && (
        <>
          <dl className="quote">
            <div>
              <dt>Service paid</dt>
              <dd>{formatMoney(run.receipt.pricePaid)} USDT0</dd>
            </div>
            <div>
              <dt>Actual network fee</dt>
              <dd>{formatMoney(run.receipt.networkFeePaid)} USDT0</dd>
            </div>
          </dl>
          <details className="receipt">
            <summary>Verified settlement receipt</summary>
            <dl>
              <dt>Purchase</dt>
              <dd>{run.receipt.purchaseId}</dd>
              <dt>Transaction</dt>
              <dd>{run.receipt.txHash}</dd>
              <dt>Settled</dt>
              <dd>{new Date(run.receipt.settledAt).toLocaleString()}</dd>
            </dl>
            {run.receipt.explorerUrl === `${network.explorerBaseUrl}/tx/${run.receipt.txHash}` &&
              /^0x[0-9a-fA-F]{64}$/.test(run.receipt.txHash) && (
                <a href={run.receipt.explorerUrl} target="_blank" rel="noreferrer">
                  View on Stablescan <ExternalLink size={14} />
                </a>
              )}
          </details>
        </>
      )}
      <div className="demo-bottom">
        <button className="text-button" onClick={onGuide}>
          Use with your agent <ArrowRight size={16} />
        </button>
        <a href="/docs/accept-payments">Accept agent payments</a>
      </div>
      {canNew && (
        <button
          className="text-button muted"
          disabled={busy}
          onClick={() => {
            localStorage.removeItem('agentic:intent');
            setRun(null);
            setQuote(null);
            void getQuote();
          }}
        >
          Review another purchase <ArrowRight size={16} />
        </button>
      )}
    </>
  );
}
