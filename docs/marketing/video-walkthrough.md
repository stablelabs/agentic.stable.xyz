# Stable Build #6: Let your assistant settle up — video script

Target: four minutes, including screen actions. Use one repayment to teach permission, execution, confirmation and revocation. Cut installation and confirmation waits; retain the address and amount checks.

## 0:00–0:25 · What is a delegated payment?

**Screen:** Title, then the demo. Introduce three labelled addresses: **You — owner**, **Agent — signer**, **Alice — recipient**. Keep **Stable Testnet · test USDT0** visible throughout.

**Narration:** “This is a delegated payment on Stable. You approve a USDT0 allowance; an assistant signs transfers with a separate key. Your wallet key stays in MetaMask. Alice covered dinner. We’re paying her back with small testnet amounts.”

**Overlay:** `Allowance: 0.01 USDT0` · `Payment: 0.006 USDT0`

## 0:25–0:55 · Which account does the assistant use?

**Screen:** Connect MetaMask. In **Configure signer**, enter `0.01`, copy the setup prompt and paste it into the assistant chat. Show the CLI’s signer address and returned approval link. Open it in the same browser; match the signer address on both screens.

**Narration:** “The setup prompt configures the agent-wallet CLI in the assistant’s environment. It creates a separate signer and returns an approval link. I check that the signer on this page matches the address the agent returned. Setup hasn’t sent a payment.”

## 0:55–1:20 · What permission are you granting?

**Screen:** Review the signer and allowance scope. Click **Approve agent**, confirm in MetaMask and wait for the confirmed `0.01` allowance.

**Narration:** “I approve 0.01 USDT0 for this signer. The tokens stay in my wallet; approval reserves none of them. This is an aggregate spending limit, valid for any recipient, with no expiry. My instruction to pay Alice will be narrower than that permission.”

**Overlay:** `You sign: approve(agent, 10_000)` · `ERC-20 units: 6 decimals`

## 1:20–1:45 · Who pays gas?

**Screen:** Run the CLI’s gas check for Alice and `0.006`. Enter its formatted funding suggestion in **Fund gas**. Confirm **Fund agent gas** in MetaMask and show the funded signer.

**Narration:** “The agent pays gas from its own account. I use the CLI’s estimate to fund it. On Stable, USDT0 pays for both transfers and gas. The native and ERC-20 interfaces expose the same balance per account. This gas funding sits outside the allowance.”

**Overlay:** `Payment: owner account · Gas: agent account` · `Native: 18 decimals · ERC-20: 6`

## 1:45–2:30 · How does Alice get paid?

**Screen:** Enter Alice’s address and `0.006` in **Send payment**. Copy the payment prompt; pause on **No payment submitted by this page**. Paste into the same assistant chat. Save the returned payment ID. Wait for `data.status: confirmed`, then open the transaction link.

**Narration:** “I’m asking the assistant to send exactly 0.006 USDT0 to Alice. Copying the prompt submits nothing. The assistant runs the CLI to sign transferFrom. In the receipt, the transaction sender is the agent, and the call goes to the USDT0 contract. I check the confirmed result and the matching Transfer event: my address, Alice’s address, 0.006.”

**Overlay:** `Agent signs: transferFrom(owner, aliceAddress, 6_000)`

**Receipt close-up:** Successful transaction; **From: agent**; **To: USDT0 contract**. Highlight the `Transfer` emitted by USDT0, **owner → Alice**, amount **0.006**.

## 2:30–3:00 · What if confirmation is uncertain?

**Screen:** Use the original payment ID with `payments wait`. Show the same confirmed transaction hash. Label this **Read-only receipt check**. Explain the timeout as a hypothetical unless one was actually captured.

**Narration:** “If the RPC times out, the payment may already have landed. I check the original payment ID. Here, that read-only query returns the same confirmed transaction. The CLI saved the signed bytes before broadcasting. Keep that ID and signer state. A new ID creates a separate payment intent; if both payments fit the allowance, both can succeed.”

## 3:00–3:25 · What happens at the spending limit?

**Screen:** Refresh step 3: `0.004` allowance remains. In the assistant chat, prepare a separate `0.006` intent for Alice and request **dry-run only**. Show `INSUFFICIENT_ALLOWANCE`, then its unsigned record with no transaction hash.

**Narration:** “After the payment, 0.004 allowance remains. I dry-run a separate 0.006 payment with a new ID. The CLI rejects it before signing: insufficient allowance. The token contract also enforces this cap; here, we’re seeing the CLI stop first.”

**Overlay:** `0.006 requested > 0.004 remaining` · `No transaction signed`

## 3:25–4:00 · How do you remove access?

**Screen:** Click **Revoke allowance**, confirm in MetaMask and wait for zero. Prepare a separate `0.001` dry-run intent to Alice. Show `INSUFFICIENT_ALLOWANCE` again. End on the demo and source links.

**Narration:** “Finally, I revoke and wait for zero. I test 0.001—an amount that fit before. The CLI refuses again. Alice is paid. The allowance is zero. The signer keeps its gas balance. Source and setup are linked below.”

**End card:** [Demo](https://agentic.stable.xyz/) · [Source and setup](https://github.com/stablelabs/agentic.stable.xyz) · Testnet only; unaudited.

## Recording notes

- Use Stable Testnet (`2201`), MetaMask, Node.js 22+ and CLI `0.2.1`. Supply a fresh absolute persistent state-directory path alongside the setup prompt; otherwise it may reuse an existing signer. Verify the resolved path with `whoami` and retain it throughout. Use a separate recipient wallet you control, labelled Alice. Keep all three addresses distinct. The config field `alice` still means the owner; the video’s Alice is the recipient.
- Fund the owner for its approval, gas top-up, payment and revocation. After the first payment and fees, leave at least `0.006` USDT0 in the owner’s balance. The CLI checks balance before allowance; a short balance would obscure the over-limit result.
- Use operator-controlled test wallets. Confirm approval, gas funding and revocation in MetaMask; the agent signs the payment.
- Run `gas check` after allowance approval, using Alice’s address and `0.006`. Require `data.available: true`. Convert `data.suggestedTopUp` from 18-decimal units to a decimal amount for the manual gas field. It is a buffered funding suggestion, not the actual fee. If estimation is unavailable, resolve that before recording.
- Each separate limit/revocation test gets a new payment ID and uses `pay --dry-run` only. The payment page blocks over-limit prompts, so run those tests through the assistant/CLI. Do not increase the allowance when a test fails. Its record should remain `created`, without a signed transaction or hash.
- Recovery uses the original successful payment ID and signer directory. `payments wait` is read-only. For an unresolved submission, consult the recovery reference before using `payments resume`; it can sign an intent that was never signed.
- Capture actual confirmations and receipts. The method is `transferFrom`; the event is `Transfer`. A transaction hash or `submitted` status alone does not prove payment.
- Show public addresses, amounts and payment IDs. Keep private keys, state file contents and unrelated chat out of frame. The signer key is stored in plaintext with restricted file permissions.
- Label accelerated footage. Keep number formatting consistent: `0.004` is remaining allowance, not wallet balance. Narrate USDT0 as “USDT zero.”

## Operator commands

Run in the agent’s environment with the recording’s original absolute `STATE_DIR`. `ALICE_ADDRESS` is the recipient. Fill `PAID_ID` from the real confirmed payment, and each test ID from its own `payments prepare` result.

```sh
# After approval; format data.suggestedTopUp before using the gas field.
agent-wallet gas check --recipient "$ALICE_ADDRESS" --amount 0.006 --state-dir "$STATE_DIR" --json

# Read-only recheck of the original payment.
agent-wallet payments wait "$PAID_ID" --timeout 60s --state-dir "$STATE_DIR" --json

# Separate over-limit test, after the 0.006 payment.
agent-wallet payments prepare --recipient "$ALICE_ADDRESS" --amount 0.006 --state-dir "$STATE_DIR" --json
agent-wallet pay --payment-id "$LIMIT_TEST_ID" --dry-run --state-dir "$STATE_DIR" --json
agent-wallet payments show "$LIMIT_TEST_ID" --state-dir "$STATE_DIR" --json

# Separate revocation test, after zero allowance is confirmed.
agent-wallet payments prepare --recipient "$ALICE_ADDRESS" --amount 0.001 --state-dir "$STATE_DIR" --json
agent-wallet pay --payment-id "$REVOKE_TEST_ID" --dry-run --state-dir "$STATE_DIR" --json
agent-wallet payments show "$REVOKE_TEST_ID" --state-dir "$STATE_DIR" --json
```
