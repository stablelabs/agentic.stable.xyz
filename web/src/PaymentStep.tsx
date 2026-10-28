import { useState } from 'react';
import { Copy, ArrowUpRight } from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Textarea } from './components/ui/textarea';
import { SKILL_URL } from './release';
import {
  address,
  formatAmount,
  parseAmount,
  validateConfig,
  type WalletConfig,
} from '../../shared/owner.js';

type Props = {
  config?: WalletConfig;
  agent: string;
  allowance?: bigint;
  ownerBalance?: bigint;
  gasBalance?: bigint;
  blocked: boolean;
  blockedReason?: string;
};

export function PaymentStep({
  config,
  agent,
  allowance,
  ownerBalance,
  gasBalance,
  blocked,
  blockedReason,
}: Props) {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('0.001');
  const [copiedPrompt, setCopiedPrompt] = useState('');
  const [failedPrompt, setFailedPrompt] = useState('');
  let selectedAgent: string | undefined;
  let selectedRecipient: string | undefined;
  let paymentAmount: bigint | undefined;
  try {
    selectedAgent = address(agent.trim(), 'agent signer');
  } catch {
    /* Wait for a valid signer. */
  }
  try {
    selectedRecipient = address(recipient.trim(), 'recipient address');
  } catch {
    /* Validate before generating instructions. */
  }
  try {
    paymentAmount = parseAmount(amount);
  } catch {
    /* Keep exact token precision. */
  }

  let issue = '';
  if (!config) issue = 'Connect MetaMask.';
  else if (!selectedAgent || selectedAgent.toLowerCase() === config.alice.toLowerCase())
    issue = 'Set a separate agent signer in step 2.';
  else if (blocked) issue = blockedReason || 'Resolve the pending wallet transaction.';
  else if (allowance === undefined || ownerBalance === undefined || gasBalance === undefined)
    issue = 'Balances unavailable. Refresh.';
  else if (allowance === 0n) issue = 'Approve an allowance in step 3.';
  else if (gasBalance === 0n) issue = 'Fund gas in step 4.';
  else if (!selectedRecipient) issue = 'Enter a nonzero recipient address.';
  else if (paymentAmount === undefined) issue = 'Use a positive amount with at most 6 decimals.';
  else if (paymentAmount > allowance) issue = 'Amount exceeds remaining allowance.';
  else if (paymentAmount > ownerBalance) issue = 'Insufficient owner balance.';

  let prompt = '';
  if (!issue && config && selectedAgent && selectedRecipient && paymentAmount !== undefined) {
    const settings = validateConfig({
      ...config,
      defaultAgent: address(selectedAgent),
      approvalUrl: new URL(location.pathname, location.origin).href,
    });
    prompt = `Send exactly ${formatAmount(paymentAmount)} USDT0 to ${selectedRecipient} on Stable Testnet (chain 2201) from my wallet ${settings.alice}. This authorizes this one payment only.

Follow the "Pay" and "Recover" sections of the agent-wallet-cli skill:
${SKILL_URL}

Use the signer you created during setup; whoami must return ${selectedAgent}. If you can't find it, ask me where it is. Don't create a new signer.

If that signer isn't configured yet, import these settings. If it's configured for a different owner, stop and tell me.
${JSON.stringify(settings, null, 2)}`;
  }
  const copied = !!prompt && copiedPrompt === prompt;
  const copyFailed = !!prompt && failedPrompt === prompt;
  async function copy() {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedPrompt(prompt);
      setFailedPrompt('');
    } catch {
      setFailedPrompt(prompt);
      setCopiedPrompt('');
    }
  }

  return (
    <section className="payment-step" aria-label="Send payment">
      <p className="form-note">
        Paste the payment prompt into the same agent chat. The agent signs and submits.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void copy();
        }}
      >
        <div className="form-grid">
          <label>
            Recipient address
            <Input
              aria-label="Recipient address"
              required
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="0x…"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={!!recipient && !selectedRecipient}
              aria-describedby="recipient-help"
            />
          </label>
          <label>
            Payment amount (USDT0)
            <Input
              required
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-invalid={!!amount && paymentAmount === undefined}
              aria-describedby="payment-help"
            />
          </label>
        </div>
        <p id="recipient-help" className="field-error">
          {recipient && !selectedRecipient ? 'Enter a nonzero recipient address.' : ''}
        </p>
        <p id="payment-help" className="field-error">
          {amount && paymentAmount === undefined
            ? 'Use a positive amount with at most 6 decimals.'
            : ''}
        </p>
        {config && (
          <p className="form-note">
            Remaining allowance:{' '}
            <strong>
              {allowance === undefined ? 'Unavailable' : `${formatAmount(allowance)} USDT0`}
            </strong>
          </p>
        )}
        <Button type="submit" disabled={!prompt}>
          <Copy size={16} aria-hidden="true" />
          {copied ? 'Payment prompt copied' : 'Copy payment prompt'}
        </Button>
        <p className="form-note" aria-live="polite">
          {issue ||
            (copyFailed
              ? 'Clipboard access is blocked. Select and copy the payment prompt below.'
              : copied
                ? 'Check the agent’s receipt.'
                : 'Paste in your agent chat to authorize this payment.')}
        </p>
      </form>
      {prompt && (
        <details className="setup-prompt" open={copyFailed ? true : undefined}>
          <summary>Payment prompt</summary>
          <Textarea
            aria-label="Agent payment prompt"
            readOnly
            value={prompt}
            rows={12}
            onFocus={(event) => event.currentTarget.select()}
          />
        </details>
      )}
      {prompt && (
        <div className="payment-review">
          <span>Payment</span>
          <p>
            <strong>{formatAmount(paymentAmount!)} USDT0</strong> to{' '}
            <code>{selectedRecipient}</code>
          </p>
        </div>
      )}
      {copied && (
        <div className="handoff-state">
          <h3>Submit via agent</h3>
          <p>No payment submitted by this page.</p>
          <p>
            Require <code>confirmed</code>, payment ID and transaction link. Verify recipient and
            amount; revoke unused allowance in step 3.
          </p>
          <p>Recover uncertain payments with the same ID. A new ID can pay twice.</p>
          <a href="https://testnet.stablescan.xyz" target="_blank" rel="noreferrer">
            Explorer <ArrowUpRight size={14} />
          </a>
        </div>
      )}
      <p className="form-note">RPC access required. CLI estimates gas before signing.</p>
    </section>
  );
}
