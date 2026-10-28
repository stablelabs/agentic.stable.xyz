# Tweet thread

## 1/6

Approve 0.01 USDT0. Let your agent pay 0.006. Dry-run another 0.006.

That last request should fail.

Try it on Stable Testnet:
https://agentic.stable.xyz/

## 2/6

Your wallet key stays in MetaMask. The agent has its own signer.

You call approve. It calls transferFrom. Tokens move from your wallet to the recipient; the allowance falls from 0.01 to 0.004.

## 3/6

The contract never reads your prompt.

“Pay this recipient once” is an instruction to the agent. Its allowance permits any recipient and has no expiry. Keep it small; revoke the remainder when you’re done.

## 4/6

Same symbol, two balances: your token USDT0 funds the payment; the signer’s native USDT0 funds gas.

After paying 0.006, dry-run another 0.006. The CLI sees only 0.004 allowance left and rejects it before signing.

## 5/6

An RPC timeout can hide a successful payment.

The CLI saves signed bytes before broadcast. Recover with the same payment ID and signer directory to reuse that transaction. A new ID can pay twice.

## 6/6

Check the confirmed receipt: token transfer, recipient, amount. Then revoke the unused allowance and wait for confirmation. Gas funding stays with the signer.

Source, CLI and setup:
https://github.com/stablelabs/agentic.stable.xyz

Testnet only; unaudited.
