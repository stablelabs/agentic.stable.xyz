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
    prompt = `Send exactly ${formatAmount(paymentAmount)} USDT0 to ${selectedRecipient} on Stable Testnet (chain 2201), from my wallet ${settings.alice}, using my existing agent signer ${selectedAgent} and its approved token allowance.

Read and follow the payment and recovery sections of this skill, including the linked configuration reference when needed:
https://raw.githubusercontent.com/stablelabs/agentic.stable.xyz/refs/heads/main/skills/agent-wallet-cli/SKILL.md

Reuse the same signer state directory from setup. Verify that whoami matches ${selectedAgent}; if the original signer is unavailable, stop and ask for its location. Do not create a replacement signer or request my MetaMask private key.

These are my public wallet settings. If configuration is missing, save them to a local JSON file and import it into that same signer directory. If configuration already exists, verify that it matches the intended owner, token, and network; preserve any existing payment records:
${JSON.stringify(settings, null, 2)}

Check network access, the owner’s balance, current allowance, and the agent’s gas. If RPC access is blocked or funds are insufficient, stop and report what is needed without changing the recipient or amount.

Check for unresolved payments before preparing a new payment. Record one payment ID for this request, simulate it, then submit and verify that same payment. Recover any uncertain outcome using the original ID instead of creating another payment. This instruction authorizes this one payment only.

Report the recipient, amount, payment ID, confirmed or pending status, transaction explorer link when available, and remaining allowance. Claim completion only after verifying the onchain receipt.`;
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
