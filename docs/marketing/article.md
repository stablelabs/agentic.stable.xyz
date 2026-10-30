# Let your assistant settle up

Maya covered dinner. You owe her 6 USDT0.

“Send Maya 6 USDT0. Here’s her wallet address.”

## Give it a limit

Your wallet key stays in MetaMask. The agent has its own signer. You approve a 10 USDT0 allowance for that signer on the token contract. The money stays in your wallet until spent; approval reserves none of it.

```solidity
// You sign. ERC-20 USDT0 uses 6 decimals.
USDT0.approve(agent, 10_000_000);

// The agent signs the payment you requested.
USDT0.transferFrom(owner, maya, 6_000_000);
```

Maya receives 6 USDT0. The allowance falls to 4, assuming no other spending or changes. You don’t sign a second transaction for this payment.

The contract never sees “Maya” or “dinner.” It sees addresses and amounts. This allowance permits spending to any recipient, with no expiry. Your instruction authorizes one payment; the contract grants broader authority. Enforcing a recipient restriction or expiry requires additional controls.

## Someone still pays gas

On Stable, USDT0 covers both payments and gas. Its native and ERC-20 interfaces expose the [same underlying balance per account](https://docs.stable.xyz/en/explanation/usdt0-behavior/).

Here, the payment comes from your account. Gas comes from the agent’s separate account, which you fund beforehand. That gas spending sits outside your token allowance.

## Don’t pay for dinner twice

The agent submits the transaction. The RPC times out. Maya might already have the money.

The demo’s CLI saves the signed transaction before broadcasting. Keep the original payment ID and signer state to check or recover that payment. Starting over with a new ID creates a separate payment intent.

The CLI verifies the transaction terms and matching token transfer before reporting confirmation. A transaction hash alone doesn’t prove payment.

An allowance won’t prevent every duplicate: if both payments fit, it permits both.

## Take permission back

Set the allowance to zero. Once that transaction confirms, further payments using this allowance fail. Revocation doesn’t undo earlier transfers or reclaim the agent’s gas balance.

## Try it on testnet

The [demo](https://agentic.stable.xyz/) runs this flow with smaller amounts. Use a second testnet wallet for Maya: approve `0.01` USDT0, send `0.006`, then dry-run another `0.006`. The CLI rejects it before signing because only `0.004` allowance remains. Revoke the remainder and check that another payment fails.

First-time setup takes more work than a direct transfer. Use this example to inspect the permission you’re granting before trusting an agent with it.

[Source and setup](https://github.com/stablelabs/agentic.stable.xyz) · [CLI and recovery reference](https://github.com/stablelabs/agentic.stable.xyz/blob/main/docs/cli.md)

Testnet only; unaudited. Signer keys are plaintext files with restricted permissions. Keep the state private and persistent.
