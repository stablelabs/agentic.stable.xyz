import React, { lazy, Suspense, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Bot, Braces, FileText, ShieldCheck, X } from 'lucide-react';
import { sampleSource } from '../shared/sample';
import { track } from './telemetry';
const Demo = lazy(() => import('./Demo'));
const Guides = lazy(() => import('./Guides'));
export function Invoice() {
  const lines = Object.fromEntries(
    sampleSource.split('\n').map((s) => [s.split(':')[0], s.slice(s.indexOf(':') + 1).trim()]),
  );
  const [description, quantity, unitPrice, total] = lines.Item.split('|').map((s) => s.trim());
  return (
    <article className="invoice" aria-label="Sample invoice">
      <div className="invoice-top">
        <span className="eyebrow">
          <FileText size={14} /> Sample invoice
        </span>
        <span className="mono">{lines.Invoice}</span>
      </div>
      <h3>{lines.Vendor}</h3>
      <div className="invoice-line">
        <span>
          {description}{' '}
          <small>
            {quantity} × ${unitPrice}
          </small>
        </span>
        <span>${total}</span>
      </div>
      <div className="invoice-total">
        <span>
          Total <small>USD</small>
        </span>
        <strong>${lines.Total}</strong>
      </div>
      <p className="invoice-note">Synthetic sample data</p>
    </article>
  );
}
export default function App() {
  const [panel, setPanel] = useState<'demo' | 'agent' | 'seller' | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  function open(value: NonNullable<typeof panel>) {
    opener.current = document.activeElement as HTMLElement;
    setPanel(value);
    dialog.current?.showModal();
    track(
      value === 'demo'
        ? 'demo_opened'
        : value === 'agent'
          ? 'agent_setup_opened'
          : 'seller_guide_opened',
    );
  }
  function close() {
    dialog.current?.close();
    setPanel(null);
    opener.current?.focus();
  }
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="header">
        <a href="https://www.stable.xyz" aria-label="Stable home">
          <img className="wordmark" src="/brand/stable-wordmark.svg" alt="Stable" />
        </a>
        <span className="header-label">Agentic payments</span>
        <a className="nav-link" href="/docs/quickstart">
          Developer quickstart <ArrowUpRight size={16} />
        </a>
      </header>
      <main id="main">
        <section className="hero" aria-labelledby="headline">
          <div className="eyebrow hero-eyebrow">
            <span className="badge">Testnet</span> A sample agent workflow
          </div>
          <h1 id="headline">
            This is how agents <br />
            <strong>settle on Stable.</strong>
          </h1>
          <p className="lede">
            Agents can purchase APIs and digital services
            <br className="desktop-break" /> using stablecoins on Stable.
          </p>
          <div className="hero-actions">
            <button className="primary" onClick={() => open('demo')}>
              Try it out <ArrowRight size={19} />
            </button>
            <button className="secondary" onClick={() => open('agent')}>
              Use with your agent <ArrowUpRight size={17} />
            </button>
          </div>
          <p className="funding-note">Pre-funded testnet demo. No wallet setup needed.</p>
        </section>
        <section className="preview" aria-label="Invoice extraction preview">
          <div className="preview-heading">
            <div>
              <span className="eyebrow">One task. One paid request.</span>
              <h2>Extract an invoice within a spending budget.</h2>
            </div>
            <span className="preview-tag">Preview / no payment yet</span>
          </div>
          <div className="preview-body">
            <Invoice />
            <div className="flow">
              <ol>
                <li>
                  <Bot />
                  <span>
                    Agent<small>Sets a spending limit</small>
                  </span>
                </li>
                <li>
                  <FileText />
                  <span>
                    Service<small>Quotes the extraction</small>
                  </span>
                </li>
                <li>
                  <ShieldCheck />
                  <span>
                    Settlement<small>Verifies the payment</small>
                  </span>
                </li>
                <li>
                  <Braces />
                  <span>
                    Result<small>Returns structured data</small>
                  </span>
                </li>
              </ol>
              <div className="flow-caption">
                <span>USDT0 on Stable Testnet</span>
                <button className="text-button" onClick={() => open('seller')}>
                  Accept agent payments <ArrowUpRight size={16} />
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>
      <footer>
        <span>Built for agents. Settled on Stable.</span>
        <nav aria-label="Footer">
          <a href="/docs/quickstart">Quickstart</a>
          <a href="/docs/agent-setup">Agent setup</a>
          <a href="/docs/accept-payments">Accept payments</a>
          <a href="/docs/source">
            GitHub <ArrowUpRight size={13} />
          </a>
        </nav>
        <span className="footer-network">Testnet only</span>
      </footer>
      <dialog
        ref={dialog}
        onCancel={close}
        onClick={(e) => {
          if (e.target === dialog.current) close();
        }}
        aria-labelledby="panel-title"
      >
        <div className="dialog-inner">
          <div className="dialog-header">
            <span className="eyebrow">
              Stable / {panel === 'demo' ? 'Testnet demo' : 'Developer guide'}
            </span>
            <button
              className="icon-button"
              aria-label="Close panel"
              title="Close panel"
              onClick={close}
            >
              <X size={20} />
            </button>
          </div>
          <Suspense fallback={<p role="status">Loading...</p>}>
            {panel === 'demo' ? (
              <Demo
                onGuide={() => {
                  setPanel('agent');
                  track('agent_setup_opened');
                }}
              />
            ) : panel ? (
              <Guides kind={panel} />
            ) : null}
          </Suspense>
        </div>
      </dialog>
    </>
  );
}
