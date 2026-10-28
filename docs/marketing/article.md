# Give your agent a USDT0 allowance

Use the [Stable Testnet demo](https://agentic.stable.xyz/) to approve an allowance, configure a local agent signer, and send a test payment from your wallet.

The owner approves spending in MetaMask. The agent submits an ERC-20 `transferFrom` transaction. Tokens stay in the owner’s wallet until payment; the agent holds its own signing key and native USDT0 for gas.

## Run the demo

You need MetaMask, [test USDT0](https://faucet.stable.xyz/), and an agent with terminal access, Node.js 22+ and persistent signer storage. Use Stable Testnet, chain `2201`.

1. **Connect wallet.** Connect MetaMask to the demo.
2. **Configure signer.** Copy the setup prompt into your agent chat. It installs `@stablechain/agent-wallet-cli@0.2.1`, creates or reuses a signer, and returns an approval link. Open that link in the same browser.
3. **Approve allowance.** Review the signer address and approve `0.01` USDT0 in MetaMask.
4. **Fund gas.** Send native USDT0 to the signer through the demo. This balance is separate from the token allowance.
5. **Send payment.** Enter a recipient and `0.006` USDT0. Paste the payment prompt into the same agent chat. The agent signs and submits; the page only generates the prompt.

Check the confirmed receipt, recipient and amount. With no other spending or allowance changes, `0.004` USDT0 remains available to the signer.

## What the allowance permits

The token contract enforces the remaining allowance. It permits any recipient and has no expiry. Approval reserves no funds; payment also requires a sufficient owner balance.

The CLI checks allowance, balance and gas before signing. After the example payment, a `0.006` USDT0 dry-run exceeds the remaining `0.004` and fails before signing.

Return to **Approve allowance** to revoke the remainder. Revocation takes effect when confirmed. It does not reverse payments or return the signer’s gas balance. Changing a positive allowance requires revoking it first.

## Keep the payment record

The CLI prepares an intent with a local payment ID, saves signed transaction bytes before broadcast, and verifies the receipt before reporting `confirmed`.

If the result is uncertain, use the original payment ID and signer directory with `payments wait` or `payments resume`. A new ID can pay twice. The ID coordinates local recovery; it is not an onchain duplicate check.

[Open the demo](https://agentic.stable.xyz/) · [Source and setup](https://github.com/stablelabs/agentic.stable.xyz) · [CLI reference](https://github.com/stablelabs/agentic.stable.xyz/blob/main/docs/cli.md)

Testnet only; unaudited. Signer keys are stored locally in plaintext files with restricted permissions.
