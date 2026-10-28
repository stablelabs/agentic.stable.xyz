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

The article leads with a research agent buying a structured result from a paid API. Teach spending authority, settlement and delivery; use the demo as an executable example. The provider integration and price are illustrative. Other assets retain the earlier experiment framing until the article settles.

Keep these distinctions intact when editing:

- A one-payment prompt specifies intent; the allowance permits aggregate spending to any recipient, with no expiry.
- USDT0 pays for both the result and gas. Native and ERC-20 interfaces expose the same underlying balance per account. This demo takes payment from the owner and gas from the signer’s separate account.
- Dry-run rejection demonstrates CLI preflight. It does not demonstrate an onchain revert.
- A timeout can follow a successful payment. Recovery needs the original ID and signer state; a new intent can pay again.

Prefer consequences over feature lists. Use humor where the failure earns it. Don’t invent personal experience, guarantees or results.

## Sources

- [Demo](https://agentic.stable.xyz/)
- [Repository README](../../README.md)
- [CLI reference](../cli.md)
- [USDT0 balance model](https://docs.stable.xyz/en/explanation/usdt0-behavior/)
- [Stable pay-per-call guide](https://docs.stable.xyz/en/how-to/build-pay-per-call/) — a separate ERC-3009/x402 integration
- [Release and acceptance evidence](https://github.com/stablelabs/agentic.stable.xyz/releases/tag/cli-v0.2.1)

Publish the article and video before adding their final URLs to social copy. Use the numbered headings in the thread as post boundaries, not post text. Scheduling and distribution are pending review.
