# Video walkthrough

Target: 3 minutes. Record the shipped demo, agent chat and receipt. Cut confirmation waits; preserve the order of actions.

## Recording setup

- Use Stable Testnet (`2201`), a funded test owner, a fresh signer directory and a separate test recipient you control.
- Agent environment: Node.js 22+, CLI `0.2.1`, persistent signer storage. Let the setup prompt create the signer.
- Use `0.01` USDT0 allowance and a `0.006` USDT0 payment. Show native gas funding separately; use the CLI estimate to choose the top-up.
- Show public addresses and transaction receipts. Keep keys, state files and unrelated chat content out of frame.

## 0:00–0:15 · Introduce the demo

**Screen:** Demo landing page, then the five steps.

**Say:** “Give your agent a USDT0 allowance, then have it send a test payment. You approve spending in MetaMask. The agent runs locally and submits the payment. This is Stable Testnet.”

## 0:15–0:30 · Connect wallet

**Screen:** Click **Connect MetaMask**. Confirm the account and network in MetaMask. Show the owner address in the demo.

**Say:** “Connect your wallet. You’ll need test USDT0 and an agent with terminal access and persistent signer storage.”

## 0:30–1:00 · Configure signer

**Screen:** In **Configure signer**, enter `0.01`. Click **Copy setup prompt** and paste into the agent chat. Show the signer address and approval link returned by the agent. Open that link in the same browser.

**Say:** “Copy this setup prompt into your agent chat. It installs the CLI, configures a local signer and returns an approval link. The private key stays in the agent’s local storage. Check that the returned signer matches the approval page.”

## 1:00–1:20 · Approve allowance

**Screen:** Review **Approve allowance**: signer, `0.01` USDT0, allowance scope. Click **Approve agent**, confirm in MetaMask, then show the confirmed allowance.

**Say:** “Approve 0.01 USDT0. The tokens stay in your wallet until payment. This allowance permits any recipient and has no expiry.”

## 1:20–1:40 · Fund gas

**Screen:** Get the CLI gas estimate for the test recipient and `0.006` USDT0. Enter the chosen native USDT0 top-up in **Fund gas**. Confirm in MetaMask; show the signer’s funded gas balance.

**Say:** “Fund the signer with native USDT0 for transaction fees. This is separate from its token allowance. The top-up field is a manual amount; use the CLI estimate.”

## 1:40–2:15 · Send payment

**Screen:** In **Send payment**, enter the test recipient and `0.006`. Click **Copy payment prompt**. Show **No payment submitted by this page**, then paste into the same agent chat. Show the returned payment ID and confirmed transaction link. Open the receipt and verify recipient and amount.

**Say:** “Set the recipient and amount. Copying this prompt does not send a payment. Paste it into the same agent chat to authorize this payment. The agent signs and submits transferFrom. Check the confirmed receipt, recipient and amount.”

## 2:15–2:40 · Check the limit

**Screen:** Refresh the allowance in step 3: `0.004` USDT0. In the agent chat, request a dry-run only for another `0.006` to the same recipient. Show `INSUFFICIENT_ALLOWANCE`.

**Say:** “The remaining allowance is 0.004. A dry-run for another 0.006 fails before signing. If a submission result is uncertain, recover with the original payment ID and signer directory. A new ID can pay twice.”

## 2:40–3:00 · Revoke and close

**Screen:** Click **Revoke allowance**, confirm in MetaMask, then show zero allowance. End on the demo URL and repository link.

**Say:** “Revoke the unused allowance and wait for confirmation. Revocation does not reverse payments or return gas funding. Try the demo at agentic.stable.xyz. Source and setup are linked there. Testnet only; unaudited.”

## Verification for the edit

Use the same signer throughout. Capture the actual allowance, funding and payment receipts. Show `confirmed` before calling the payment complete. Label sped-up sections; keep testnet and example amounts legible. Add the final video URL to the repository README after upload.
