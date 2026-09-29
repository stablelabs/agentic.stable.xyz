# Use with your agent

The runnable TypeScript buyer and `examples/agent-buyer/SKILL.md` let a coding agent purchase the sample invoice extraction. It uses its own local signer and wallet challenge authentication. No browser cookie or browser-session key is used.

## Configure the buyer

From this repository, install with `npm ci`. Copy `.env.example` to `.env` and configure:

```ini
STABLE_RPC_URL=https://rpc.testnet.stable.xyz
SELLER_URL=http://localhost:8788
SELLER_ADDRESS=<seller testnet recipient>
BUYER_PRIVATE_KEY=<your dedicated funded testnet signer>
BUYER_BUDGET_USDT0=0.05
```

For the website's built-in seller, set `SELLER_URL=http://localhost:8787`. A remote seller requires HTTPS. Fund the buyer wallet with enough test USDT0 for the service and the maximum fee. Do not reuse the demo funding key. Never put credentials in a prompt, commit, or browser bundle.

## Buy and recover

```sh
npm run check:network
npm run buyer -- --new
```

`--new` deliberately authorizes one purchase within the configured cumulative budget. Quote terms, recipient, network, and maximum total are verified before signing. A pending purchase always takes precedence, even with `--new`.

```sh
npm run buyer
```

This command recovers the original signed payment or returns the existing result. After payment, retrying delivery cannot pay again. State and the exact signed transaction are stored in `.buyer-state/buyer.sqlite`; only one local process may own it. Do not delete this database to recover an uncertain transaction. There is no automatic fee bump or replacement transfer.

If a quote expires before signing, no payment has been sent. Run `npm run buyer -- --refresh-quote` to explicitly authorize a fresh quote within the same remaining budget. This command refuses to replace any signed payment and preserves cumulative spending. A signed record must always be reconciled with its existing transaction hash.

## Coding agent prompt

```text
Use examples/agent-buyer/SKILL.md in this repository. Buy extraction
of sample-invoice-01 from the configured Stable testnet seller with
a maximum total budget of 0.05 USDT0. Use the configured local testnet
signer, recover an existing purchase first, and return the result
and verified receipt. Do not print environment secrets.
```

The paid operation parses the project's synthetic invoice source and validates the totals before delivery. Its public expected output is not a private dataset. This example demonstrates paid execution and settlement evidence, not arbitrary-agent or x402 compatibility.

## Agent host verification

The host invocation and version must be recorded in the [acceptance report](/docs/acceptance/). A successful fixture test does not prove a real host completed a live purchase.
