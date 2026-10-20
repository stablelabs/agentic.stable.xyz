import { useState } from 'react';
import { address, formatAmount, parseAmount, validateConfig, type WalletConfig } from '../../shared/owner.js';

type Props = {
  config?: WalletConfig;
  agent: string;
  allowance?: bigint;
  ownerBalance?: bigint;
  gasBalance?: bigint;
  blocked: boolean;
};

export function PaymentStep({ config, agent, allowance, ownerBalance, gasBalance, blocked }: Props) {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('0.001');
  const [copiedPrompt, setCopiedPrompt] = useState('');
  const [failedPrompt, setFailedPrompt] = useState('');
  let selectedAgent: string | undefined;
  let selectedRecipient: string | undefined;
  let paymentAmount: bigint | undefined;
  try { selectedAgent = address(agent.trim(), 'agent signer'); } catch { /* Wait for a valid signer. */ }
  try { selectedRecipient = address(recipient.trim(), 'recipient address'); } catch { /* Validate before generating instructions. */ }
  try { paymentAmount = parseAmount(amount); } catch { /* Keep exact token precision. */ }

  let issue = '';
  if (!config) issue = 'Connect MetaMask above to use your wallet and agent.';
  else if (!selectedAgent || selectedAgent.toLowerCase() === config.alice.toLowerCase()) issue = 'Enter your agent’s separate signer address above.';
  else if (blocked) issue = 'Resolve any pending wallet operation before preparing a payment prompt.';
  else if (allowance === undefined || ownerBalance === undefined || gasBalance === undefined) issue = 'Waiting for the wallet balances and allowance. Refresh above if needed.';
  else if (allowance === 0n) issue = 'Approve your agent’s token allowance above first.';
  else if (gasBalance === 0n) issue = 'Fund your agent’s gas above first.';
  else if (!selectedRecipient) issue = 'Enter a valid, nonzero recipient address.';
  else if (paymentAmount === undefined) issue = 'Enter a positive USDT0 amount with at most 6 decimal places.';
  else if (paymentAmount > allowance) issue = 'The payment exceeds your agent’s remaining allowance.';
  else if (paymentAmount > ownerBalance) issue = 'Your wallet does not have enough USDT0 for this payment.';

  let prompt = '';
  if (!issue && config && selectedAgent && selectedRecipient && paymentAmount !== undefined) {
    const settings = validateConfig({ ...config, defaultAgent: address(selectedAgent), approvalUrl: new URL(location.pathname, location.origin).href });
    prompt = `Send exactly ${formatAmount(paymentAmount)} USDT0 to ${selectedRecipient} on Stable Testnet (chain 2201) from my wallet ${settings.alice}. This authorizes this one payment only.

Follow the "Pay" and "Recover" sections of the agent-wallet-cli skill:
https://raw.githubusercontent.com/stablelabs/agentic.stable.xyz/refs/heads/main/skills/agent-wallet-cli/SKILL.md

Use the signer you created during setup; whoami must return ${selectedAgent}. If you can't find it, ask me where it is. Don't create a new signer.

If that signer isn't configured yet, import these settings. If it's configured for a different owner, stop and tell me.
${JSON.stringify(settings, null, 2)}`;
  }
  const copied = !!prompt && copiedPrompt === prompt;
  const copyFailed = !!prompt && failedPrompt === prompt;
  async function copy() {
    if (!prompt) return;
    try { await navigator.clipboard.writeText(prompt); setCopiedPrompt(prompt); setFailedPrompt(''); }
    catch { setFailedPrompt(prompt); setCopiedPrompt(''); }
  }

  return <section className="create-panel" aria-label="Make your first payment">
    <p className="eyebrow">PAY WITH YOUR AGENT</p><h2>Make your first payment</h2>
    <p className="form-note">Choose a recipient and amount, then paste the payment prompt into the same agent chat you used for setup. Your agent will check, sign, and send the payment from your allowance.</p>
    <form onSubmit={event => { event.preventDefault(); void copy(); }}>
      <div className="form-grid">
        <label>Recipient address<input aria-label="Recipient address" required value={recipient} onChange={event => setRecipient(event.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} aria-invalid={!!recipient && !selectedRecipient} /></label>
        <label>Payment amount (USDT0)<input required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} aria-invalid={!!amount && paymentAmount === undefined} /></label>
      </div>
      {config && <p className="form-note">Remaining allowance: <strong>{allowance === undefined ? 'Unavailable' : `${formatAmount(allowance)} USDT0`}</strong></p>}
      <button className="primary" type="submit" disabled={!prompt}>{copied ? 'Payment prompt copied' : 'Copy payment prompt'}</button>
      <p className="form-note" aria-live="polite">{issue || (copyFailed ? 'Clipboard access is blocked. Select and copy the payment prompt below.' : copied ? 'Paste into the same agent chat to request this payment. The agent will report its result there.' : 'Copying does not move funds. Pasting this prompt asks your agent to send the specified payment.')}</p>
    </form>
    {prompt && <details className="setup-prompt" open={copyFailed ? true : undefined}><summary>View or manually copy payment prompt</summary><textarea aria-label="Agent payment prompt" readOnly value={prompt} rows={12} onFocus={event => event.currentTarget.select()} /></details>}
    <p className="form-note">Sending a payment requires RPC access in your agent’s environment. The agent checks the exact gas needed before sending.</p>
  </section>;
}
