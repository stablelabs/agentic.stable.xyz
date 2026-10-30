# Let your assistant settle up

An assistant can spend from your wallet using its own signer. You grant that authority through an ERC-20 allowance, which caps how many tokens it can transfer. Your wallet key stays in MetaMask.

This build uses a [demo on Stable Testnet](https://agentic.stable.xyz/) and `@stablechain/agent-wallet-cli` to follow a payment from approval to confirmation and revocation. The page prepares prompts; the CLI runs in your assistant’s environment, signs `transferFrom` transactions and preserves them for recovery. Payments and gas both use USDT0.

Suppose Alice covered dinner. You owe her 6 USDT0:

“Send Alice 6 USDT0. Here’s her wallet address.”

## What are you authorizing?

You approve 10 USDT0 for the agent’s signer:

```solidity
// Signed by you. ERC-20 USDT0 uses 6 decimals.
USDT0.approve(agent, 10_000_000);
```

The token contract records `allowance(owner, agent)`. That grant permits aggregate spending up to 10 USDT0, to any recipient. It has no expiry and reserves no funds.

The allowance does not encode Alice, dinner or “once.” Your instruction authorizes one payment; the signer holds broader authority. Recipient restrictions and expiry require a different authorization design.

## Who signs the payment and pays gas?

With approval confirmed, the agent signs a transaction calling the USDT0 contract:

```solidity
// Signed by the agent.
USDT0.transferFrom(owner, aliceAddress, 6_000_000);
```

The contract checks your balance and the agent’s allowance. A successful transfer moves 6 USDT0 from your account to Alice’s and reduces the allowance to 4, assuming no other spending or changes.

The agent pays gas from its own account. On Stable, USDT0 is also the native gas asset: its native interface uses 18 decimals; its ERC-20 interface uses 6. Both expose the [same underlying balance per account](https://docs.stable.xyz/en/explanation/usdt0-behavior/).

Fund the signer for gas before sending. Those fees sit outside your token allowance.

## How do you verify Alice got paid?

A transaction hash gives you something to look up. Confirmation requires a successful receipt with evidence of the requested transfer.

The CLI verifies the transaction’s signer, token contract and calldata, and matches a USDT0 `Transfer` event from your address to Alice’s for the exact amount. It reports `confirmed` only after those checks pass.

## What if the RPC times out?

The transaction can land while your client is waiting for a response. Alice may already have the money.

The CLI persists the signed transaction and nonce before broadcasting. Keep the original payment ID and signer directory to check or recover that transaction. Recovery can reuse the saved signed bytes.

Starting over with a new ID creates a separate payment intent. The ID is local bookkeeping, not an onchain duplicate check. If two payments fit within the allowance, the contract permits both.

## How do you revoke access?

Once Alice’s payment is confirmed, sign `approve(agent, 0)` from your wallet and wait for confirmation. Further payments using that allowance then fail. Revocation doesn’t undo confirmed transfers or reclaim the signer’s gas balance.

## How do you run the demo?

The [demo](https://agentic.stable.xyz/) runs this flow on Stable Testnet with smaller amounts. Use a second testnet wallet for Alice: approve `0.01` USDT0, send `0.006`, then dry-run another `0.006`. The CLI rejects it before signing because only `0.004` allowance remains. Revoke the remainder and check that another payment fails.

[Source and setup](https://github.com/stablelabs/agentic.stable.xyz) · [CLI and recovery reference](https://github.com/stablelabs/agentic.stable.xyz/blob/main/docs/cli.md)

Testnet only; unaudited. Signer keys are plaintext files with restricted permissions. Keep the state private and persistent.
