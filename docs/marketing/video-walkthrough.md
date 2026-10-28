# Video walkthrough

Target: 3 minutes. Follow one allowance through a payment, a refused dry-run and revocation. Let the screen carry the clicks; use narration for what changes.

## Recording setup

- Use Stable Testnet (`2201`), a funded test owner, a fresh signer directory and a separate test recipient you control.
- Agent environment: Node.js 22+, CLI `0.2.1`, persistent signer storage. Let the setup prompt create the signer. Signing can happen in a remote agent runtime; don’t imply it must run on the viewer’s laptop.
- Use `0.01` USDT0 allowance and a `0.006` USDT0 payment. Keep the owner funded for both payment tokens and owner transaction gas.
- Show public addresses and transaction receipts. Keep keys, state files and unrelated chat content out of frame.

## 0:00–0:15 · Set up the experiment

**Screen:** Demo landing page, then the five steps.

**Say:** “Approve 0.01 USDT0. Let your agent pay 0.006. Then dry-run another 0.006. That last request should fail.”

**Caption:** Stable Testnet · chain 2201 · Testnet only; unaudited.

## 0:15–0:30 · Connect wallet

**Screen:** Click **Connect MetaMask**. Confirm the account and network in MetaMask. Show the owner address in the demo.

**Say:** “Your wallet key stays in MetaMask. The agent gets a separate signer. The allowance connects the two.”

**Caption:** Requires test USDT0, MetaMask, and an agent with terminal access, Node.js 22+ and persistent storage.

## 0:30–1:00 · Configure signer

**Screen:** In **Configure signer**, enter `0.01`. Click **Copy setup prompt** and paste into the agent chat. Show the signer address and approval link returned by the agent. Open that link in the same browser.

**Say:** “Paste the setup prompt into your agent chat. It configures the signer and returns an approval link. Check this address carefully. It’s the address you’re giving permission to spend.”

## 1:00–1:20 · Approve allowance

**Screen:** Review **Approve allowance**: signer, `0.01` USDT0, allowance scope. Click **Approve agent**, confirm in MetaMask, then show the confirmed allowance.

**Say:** “Approve 0.01 USDT0. Your tokens stay in your wallet. The contract never reads your prompt: this allowance permits any recipient and has no expiry.”

## 1:20–1:40 · Fund gas

**Screen:** After allowance approval, run `gas check` for the test recipient and `0.006` USDT0 in the agent’s environment. Require `data.available: true`. Format `data.suggestedTopUp` from 18-decimal native units into a decimal USDT0 amount before entering it in **Fund gas**. Confirm in MetaMask; show the signer’s funded gas balance. The field does not import the estimate automatically.

**Say:** “Same symbol, two balances. Your token USDT0 funds the payment. The signer’s native USDT0 funds gas. Approval funds neither. Use the CLI estimate for this top-up.”

## 1:40–2:15 · Send payment

**Screen:** In **Send payment**, enter the test recipient and `0.006`. Click **Copy payment prompt**. Show **No payment submitted by this page**, then paste into the same agent chat. Show the returned payment ID and `data.status: confirmed`. Open the transaction link and highlight the matching USDT0 `Transfer` event: owner, recipient and amount.

**Say:** “The page gives you a prompt. Paste it into the same agent chat to authorize this payment. The agent signs transferFrom and submits it. Open the confirmed receipt. Check the token transfer: your wallet, this recipient, 0.006.”

## 2:15–2:40 · Check the limit

**Screen:** Refresh the allowance in step 3: `0.004` USDT0. In the agent chat, request a dry-run only for a separate `0.006` intent to the same recipient. Do not reuse the confirmed payment’s ID for this different intent. Show `INSUFFICIENT_ALLOWANCE`; inspect the test intent with `payments show` to show it remains `created`, with no transaction hash. Do not request a larger allowance.

**Say:** “There’s 0.004 left. Another 0.006 exceeds it. The CLI refuses before signing; the token also enforces the allowance onchain.”

## 2:40–3:00 · Revoke and close

**Screen:** Click **Revoke allowance**, confirm in MetaMask, then show zero allowance. End on the demo URL and repository link.

**Say:** “Revoke the remainder and wait for confirmation. The allowance is zero. The payment stays paid; gas funding stays with the signer. Try it at agentic.stable.xyz. Source and setup are linked there.”

**End card:** Uncertain payment? Keep the ID and signer directory. `payments wait` checks the receipt. See the CLI recovery reference before retrying.

## Verification for the edit

Use the same signer throughout. Capture actual receipts. Cut confirmation waits and label sped-up sections. Never substitute a submitted hash for payment confirmation. Keep token and native amounts distinct. Add the final video URL to the repository README after upload.
