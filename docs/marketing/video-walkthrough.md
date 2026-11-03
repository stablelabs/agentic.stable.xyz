# Stable Build #6: Agentic Payments on Stable: Delegated Spending, Verification, and Recovery — video script

Target: four minutes, including screen actions. Teach the payment model through owner, agent and recipient roles. Use the demo as evidence for each concept. Cut installation and confirmation waits; retain the address, amount and receipt checks.

## 0:00–0:35 · The delegated spending model

**Screen:** Title card: **Agentic Payments on Stable: Delegated Spending, Verification, and Recovery**. Introduce **Owner — funds and approval**, **Agent — separate signer**, **Recipient — receives payment**. Animate an allowance as a permission link between owner and agent; show the payment moving from owner to recipient. Keep **Stable Testnet · test USDT0** visible throughout.

**Narration:** “An agent can pay from another wallet using an ERC-20 allowance. The owner holds the funds and approves a spending limit. The agent signs transactions with a separate key. This Stable Testnet demo pairs MetaMask with the agent-wallet CLI. The browser prepares prompts; the CLI signs and submits in the agent’s environment. The owner’s wallet key stays in MetaMask.”

**Screen transition:** Connect the wallet and set `0.01` in **Configure signer** before copying the setup prompt. Show the returned approval link. Match the CLI’s signer address to the spender on the approval page. Keep setup operations brief; label the three addresses consistently.

## 0:35–1:15 · Grant spending authority

**Screen:** Review the spender, `0.01` amount and allowance scope on the returned approval page, then show the owner’s MetaMask approval. Wait for the confirmed allowance. Pause on the token call and its result.

**Narration:** “An allowance specifies how much the spender may draw from the owner’s balance. Here, approve sets that amount to 0.01 USDT0. Approval neither funds the agent nor reserves the approved amount. The allowance permits aggregate spending to any recipient and has no expiry. A prompt can request one exact payment, but those terms aren’t encoded in this allowance.”

**Overlay:** `Owner signs: approve(agent, 10_000)` · `Allowance: 0.01 USDT0` · `Any recipient · No expiry`

## 1:15–2:00 · Execute a USDT0 payment

**Screen:** Run `gas check` for the recipient and `0.006`. Use its formatted funding suggestion in **Fund gas** and confirm the top-up. Enter the recipient and `0.006` in **Send payment**. Copy the prompt into the same agent chat; show the CLI’s payment ID and submission.

**Narration:** “The agent needs gas before it can send. Fund its account using the CLI’s estimate. On Stable, USDT0 pays for both payments and gas; the native and ERC-20 interfaces expose the same balance per account. The agent then signs transferFrom, specifying owner, recipient and amount. The contract checks the owner’s balance and the agent’s allowance. A successful 0.006 payment reduces the allowance to 0.004. Gas fees come from the agent’s account, outside that allowance.”

**Overlay:** `Agent signs: transferFrom(owner, recipient, 6_000)` · `Native: 18 decimals · ERC-20: 6`

**Keep visible:** **No payment submitted by this page** when copying the prompt. Separate the owner’s gas top-up from the agent’s payment transaction.

## 2:00–2:30 · Verify execution and confirmation

**Screen:** Wait for `data.status: confirmed`. Open the returned transaction link. Show its successful receipt, sender, destination and matching USDT0 `Transfer` event. Highlight the owner, recipient and amount in that event.

**Narration:** “A submitted transaction can still fail. Verification requires a successful receipt and a matching Transfer event from the USDT0 contract. Check the owner, recipient and exact amount. The transaction sender is the agent; the transaction destination is the token contract. The CLI verifies those terms before reporting confirmed.”

**Overlay:** `Transaction: agent → USDT0 contract` · `Token transfer: owner → recipient`

## 2:30–3:10 · Recover an uncertain transaction

**Screen:** Show the original payment ID, then use it with `payments wait`. Highlight the same confirmed transaction hash. Label this **Read-only receipt check**. Explain a timeout as a hypothetical unless one was actually captured.

**Narration:** “An RPC timeout means the client didn’t receive an answer. The payment may already have succeeded. The CLI saves signed bytes before broadcasting. Use the original payment ID and signer directory to inspect that transaction. Here, payments wait confirms the same transaction without submitting another payment. A new ID creates a separate intent; the allowance won’t prevent duplicates that fit within its remaining limit.”

**Overlay:** `Same payment: original ID + original signer state`

## 3:10–4:00 · Test the limit and revoke access

**Screen:** Refresh step 3: `0.004` allowance remains. In the agent chat, prepare a separate `0.006` intent and run **dry-run only**. Show `INSUFFICIENT_ALLOWANCE` and its unsigned record. Revoke through MetaMask and wait for zero. Prepare a separate `0.001` dry-run; show it failing too.

**Narration:** “The remaining allowance is 0.004. A separate 0.006 dry-run is rejected before signing. The token contract enforces the same limit onchain. To remove spending authority, the owner calls approve with zero and waits for confirmation. A 0.001 request now fails, even though it fit before. Confirmed payments remain unchanged, and unused gas stays with the agent. The demo and source code are linked below.”

**Overlay:** `New request: new intent ID` · `Owner signs: approve(agent, 0)` · `Allowance: 0`

**End card:** [Demo](https://agentic.stable.xyz/) · [Source and setup](https://github.com/stablelabs/agentic.stable.xyz) · Testnet only; unaudited.

## Recording notes

- Use Stable Testnet (`2201`), MetaMask, Node.js 22+ and CLI `0.2.1`. Supply a fresh absolute persistent state-directory path alongside the setup prompt; otherwise it may reuse an existing signer. Verify the resolved path with `whoami` and retain it throughout. Use a separate recipient wallet you control. Keep all three addresses distinct. The CLI’s public config field `alice` means the owner; retain that actual field name and label the roles correctly in the video.
- Fund the owner for its approval, gas top-up, payment and revocation. After the first payment and fees, leave at least `0.006` USDT0 in the owner’s balance. The CLI checks balance before allowance; a short balance would obscure the over-limit result.
- Use operator-controlled test wallets. Confirm approval, gas funding and revocation in MetaMask; the agent signs the payment.
- Run `gas check` after allowance approval, using the recipient’s address and `0.006`. Require `data.available: true`. Convert `data.suggestedTopUp` from 18-decimal units to a decimal amount for the manual gas field. It is a buffered funding suggestion, not the actual fee. If estimation is unavailable, resolve that before recording.
- Each separate limit/revocation test gets a new payment ID and uses `pay --dry-run` only. The payment page blocks over-limit prompts, so run those tests through the assistant/CLI. Do not increase the allowance when a test fails. Its record should remain `created`, without a signed transaction or hash.
- Recovery uses the original successful payment ID and signer directory. `payments wait` is read-only. For an unresolved submission, consult the recovery reference before using `payments resume`; it can sign an intent that was never signed.
- Capture actual confirmations and receipts. The method is `transferFrom`; the event is `Transfer`. A transaction hash or `submitted` status alone does not prove payment.
- Show public addresses, amounts and payment IDs. Keep private keys, state file contents and unrelated chat out of frame. The signer key is stored in plaintext with restricted file permissions.
- Label accelerated footage. Keep number formatting consistent: `0.004` is remaining allowance, not wallet balance. Narrate USDT0 as “USDT zero.”

## Operator commands

Run in the agent’s environment with the recording’s original absolute `STATE_DIR`. `RECIPIENT_ADDRESS` is the recipient. Fill `PAID_ID` from the real confirmed payment, and each test ID from its own `payments prepare` result.

```sh
# After approval; format data.suggestedTopUp before using the gas field.
agent-wallet gas check --recipient "$RECIPIENT_ADDRESS" --amount 0.006 --state-dir "$STATE_DIR" --json

# Read-only recheck of the original payment.
agent-wallet payments wait "$PAID_ID" --timeout 60s --state-dir "$STATE_DIR" --json

# Separate over-limit test, after the 0.006 payment.
agent-wallet payments prepare --recipient "$RECIPIENT_ADDRESS" --amount 0.006 --state-dir "$STATE_DIR" --json
agent-wallet pay --payment-id "$LIMIT_TEST_ID" --dry-run --state-dir "$STATE_DIR" --json
agent-wallet payments show "$LIMIT_TEST_ID" --state-dir "$STATE_DIR" --json

# Separate revocation test, after zero allowance is confirmed.
agent-wallet payments prepare --recipient "$RECIPIENT_ADDRESS" --amount 0.001 --state-dir "$STATE_DIR" --json
agent-wallet pay --payment-id "$REVOKE_TEST_ID" --dry-run --state-dir "$STATE_DIR" --json
agent-wallet payments show "$REVOKE_TEST_ID" --state-dir "$STATE_DIR" --json
```
