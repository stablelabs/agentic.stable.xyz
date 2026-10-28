# Let your agent buy the missing data

You ask an agent to compare three companies. It finds the filings, but needs a service that turns one awkward document into structured financial data. The service charges per result.

Suppose the provider quotes `0.006` USDT0 for the extraction. Your agent should be able to buy that result and finish the comparison, within a spending limit you chose. This provider and price are illustrative.

## Give the signer an allowance

Your wallet key stays in MetaMask. The agent has its own signer. You approve `0.01` USDT0 of spending authority on the token contract; your application separately authorizes the quoted `0.006` payment to this provider.

```solidity
// You sign. ERC-20 USDT0 uses 6 decimals.
USDT0.approve(agent, 10_000);

// The agent signs the authorized payment.
USDT0.transferFrom(owner, provider, 6_000);
```

The tokens stay in your wallet until payment. The provider receives `0.006`; the signer has `0.004` allowance remaining, assuming no other spending or changes.

The contract never reads your prompt. Your application must validate the provider, price and order before authorizing payment. The allowance itself permits any recipient and has no expiry. Onchain recipient or expiry restrictions need a different authorization design.

## One asset covers payment and gas

On Stable, USDT0 is both the payment asset and the native gas asset. Its native interface uses 18 decimals; its ERC-20 interface uses 6. Both expose the [same underlying balance per account](https://docs.stable.xyz/en/explanation/usdt0-behavior/).

In this design, payment comes from your account and gas comes from the agent’s. Fund the signer accordingly. Its gas spending sits outside the allowance you approved.

## Match the money to the work

The provider needs an order record: extraction, price, payer, recipient, token and chain. It must match the confirmed token `Transfer` event to those terms and ensure one payment cannot unlock several orders.

`transferFrom` carries no order ID. Your application supplies that association. The CLI’s local payment ID tracks transaction recovery.

The payment lands. The API reply disappears.

The CLI saves signed bytes before broadcast. Keep its payment ID and signer state to check or recover that transaction. Then retry delivery against the same provider order. Paying again is an expensive way to retry an HTTP request.

Payment confirmation proves the money moved. Your order system still has to track whether the result arrived. Settlement alone provides no delivery guarantee.

## Try the payment mechanism

The [demo](https://agentic.stable.xyz/) isolates this part: approve `0.01`, send `0.006`, dry-run another `0.006`, then revoke the remainder. The CLI rejects that second request before signing because only `0.004` allowance remains.

It runs on Stable Testnet and includes no paid API or order system. For an HTTP payment protocol, Stable also documents [pay-per-call APIs with x402](https://docs.stable.xyz/en/how-to/build-pay-per-call/), using ERC-3009 authorizations through a separate integration.

[Source and setup](https://github.com/stablelabs/agentic.stable.xyz) · [CLI and recovery reference](https://github.com/stablelabs/agentic.stable.xyz/blob/main/docs/cli.md)

The demo is testnet only and unaudited. Its signer keys are plaintext files with restricted permissions; keep the state private and persistent.
