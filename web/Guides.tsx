import { useState } from 'react';
import { ArrowUpRight, Check, Copy } from 'lucide-react';
import { track } from './telemetry';
export default function Guides({ kind }: { kind: 'agent' | 'seller' }) {
  const [copied, setCopied] = useState(false);
  const command =
    kind === 'agent'
      ? 'npm ci\nnpm run check:network\nnpm run buyer -- --new'
      : 'npm ci\nnpm run check:network\nnpm run seller';
  const prompt =
    'Use examples/agent-buyer/SKILL.md in this repository. Buy extraction of sample-invoice-01 from the configured Stable testnet seller with a maximum total budget of 0.05 USDT0. Use the configured local testnet signer, recover any existing purchase first, and return the result and verified receipt.';
  return (
    <>
      <h2 id="panel-title">{kind === 'agent' ? 'Use with your agent' : 'Accept agent payments'}</h2>
      <p className="panel-lede">
        {kind === 'agent'
          ? 'Give your coding agent a bounded way to buy invoice extraction on Stable Testnet.'
          : 'Run the reference invoice seller with quotes, verified payments, and repeatable delivery.'}
      </p>
      <ol className="guide-steps">
        <li>Open this project and install its dependencies.</li>
        <li>
          {kind === 'agent'
            ? 'Configure a local testnet signer, seller URL, and spending budget in .env.'
            : 'Configure your testnet recipient and durable seller database in .env.'}
        </li>
        <li>
          {kind === 'agent'
            ? 'Fund that wallet with test USDT0, then run the buyer.'
            : 'Start the seller and give buyers its URL.'}
        </li>
      </ol>
      <div className="code-block">
        <pre>{command}</pre>
        <button
          className="icon-button"
          aria-label="Copy setup"
          title="Copy setup"
          onClick={async () => {
            await navigator.clipboard.writeText(command);
            setCopied(true);
            track('setup_copied');
          }}
        >
          {copied ? <Check size={18} /> : <Copy size={18} />}
        </button>
      </div>
      {kind === 'agent' && (
        <>
          <h3>Ask your agent</h3>
          <p className="prompt">{prompt}</p>
          <p>The example uses your own signer. Browser demo keys are never exported.</p>
        </>
      )}
      <a
        className="primary"
        href={kind === 'agent' ? '/docs/agent-setup' : '/docs/accept-payments'}
      >
        Read the full guide <ArrowUpRight size={18} />
      </a>
    </>
  );
}
