# Let an agent pay from your wallet

Approve `0.01` USDT0. Pay `0.006`. Dry-run another `0.006`.

That last request should fail.

Try it on [Stable Testnet](https://agentic.stable.xyz/), chain `2201`. You’ll need MetaMask, [test USDT0](https://faucet.stable.xyz/), and an agent with terminal access, Node.js 22+ and persistent storage.

## Who signs what

Your wallet key stays in MetaMask. The agent gets a separate signer in its own environment. You approve that signer on the USDT0 contract:

```solidity
// You sign. USDT0 has 6 decimals.
USDT0.approve(agent, 10_000); // 0.01 USDT0

// The agent signs.
USDT0.transferFrom(owner, recipient, 6_000); // 0.006 USDT0
```

Approval leaves the tokens in your wallet. `transferFrom` moves them to the recipient and reduces the allowance. In this example, `0.004` remains.

The contract never reads your prompt. “Send this amount to this recipient, once” is an instruction to the agent. The allowance permits aggregate spending up to the approved amount, to any recipient, with no expiry.

## Same symbol, two balances

The owner supplies token USDT0 for payments. The signer needs native USDT0 for gas. Approving tokens does not fund either balance.

In the demo, connect MetaMask and paste the setup prompt into your agent chat. Open the returned approval link in the same browser. Check the signer, approve `0.01`, then fund its gas separately.

Set a recipient and `0.006` in step 5. Paste the payment prompt into the same chat. The CLI signs and submits from the agent’s environment; copying the prompt on the page sends nothing.

## Test the boundary

Check the confirmed receipt, including the token’s `Transfer` event: your wallet, the recipient and `0.006` USDT0. Refresh the allowance: `0.004`, assuming no other spending or changes.

Ask the agent to dry-run another `0.006`. The CLI returns `INSUFFICIENT_ALLOWANCE` before signing. This exercises its preflight check; the token contract also enforces the allowance onchain.

Revoke the remainder in step 3. Wait for confirmation. Revocation stops further allowance spending; completed payments and gas funding stay where they went.

## When the reply goes missing

An RPC timeout can hide a successful payment. Sending another payment to find out is an expensive debugging technique.

The CLI saves signed bytes before broadcast. Keep the payment ID and signer directory: `payments wait` checks the receipt; `payments resume` can reuse the saved transaction and nonce. A new ID starts a separate intent and can pay twice. These IDs live in local state, so recovery depends on keeping that state.

[Demo](https://agentic.stable.xyz/) · [Source and setup](https://github.com/stablelabs/agentic.stable.xyz) · [CLI and recovery reference](https://github.com/stablelabs/agentic.stable.xyz/blob/main/docs/cli.md)

Testnet only; unaudited. Signer keys are plaintext files with restricted permissions. Keep them private.
