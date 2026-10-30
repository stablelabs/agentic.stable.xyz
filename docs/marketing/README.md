# Marketing drafts

Based on the shipped five-step demo and CLI `0.2.1`. These files are drafts; nothing is scheduled or published.

Demo source: `f8c381aa5b6345ac2bce43c455e80fd4dbc89b85`. CLI and skill: `cli-v0.2.1`.

| Asset | File | Status |
| --- | --- | --- |
| Article | [article.md](article.md) | Draft |
| Tweet thread | [tweet-thread.md](tweet-thread.md) | Draft; six posts |
| Discord announcement | [discord-announcement.md](discord-announcement.md) | Draft |
| Video walkthrough | [video-walkthrough.md](video-walkthrough.md) | Script; recording and edit pending |

## Editorial direction

The article follows a repayment to Alice through authorization, signing and gas, confirmation, timeout recovery and revocation. Question headings follow that transaction lifecycle. Use the demo as an executable example: the story uses 10/6 USDT0; the testnet walkthrough uses 0.01/0.006. Other assets retain the earlier experiment framing until the article settles.

Keep these distinctions intact when editing:

- A one-payment prompt specifies intent; the allowance permits aggregate spending to any recipient, with no expiry.
- USDT0 pays for both the transfer and gas. Native and ERC-20 interfaces expose the same underlying balance per account. This demo takes payment from the owner and gas from the signer’s separate account.
- Dry-run rejection demonstrates CLI preflight. It does not demonstrate an onchain revert.
- A timeout can follow a successful payment. Recovery needs the original ID and signer state; a new intent can pay again.

Prefer consequences over feature lists. Use humor where the failure earns it. Don’t invent personal experience, guarantees or results.

## Sources

- [Demo](https://agentic.stable.xyz/)
- [Repository README](../../README.md)
- [CLI reference](../cli.md)
- [USDT0 balance model](https://docs.stable.xyz/en/explanation/usdt0-behavior/)
- [Release and acceptance evidence](https://github.com/stablelabs/agentic.stable.xyz/releases/tag/cli-v0.2.1)

Publish the article and video before adding their final URLs to social copy. Use the numbered headings in the thread as post boundaries, not post text. Scheduling and distribution are pending review.
