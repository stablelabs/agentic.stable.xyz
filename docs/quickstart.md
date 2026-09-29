# Run the Stable agentic demo

This project owns the website, session wallets, invoice seller, and buyer example. Payments use native USDT0 on Stable Testnet only. The website runs a deterministic sample agent workflow; it does not run an LLM.

## Local setup

Use Node 22 LTS and npm. From this source checkout:

```sh
git clone https://github.com/stablelabs/agentic.stable.xyz.git
cd agentic.stable.xyz
npm ci
cp .env.example .env
npm run dev
```

Open http://localhost:5173. The API runs on port 8787, proxied under the same origin. With the default configuration, the page and guides work and the demo reports that testnet funding is unavailable. No fixture is substituted for a payment.

The repository is currently private; the clone command requires repository access. When already in a checkout, skip the clone and directory-change commands.

## Enable testnet purchases

Set these server-only values in `.env`:

```ini
PAYMENTS_ENABLED=true
PUBLIC_ORIGIN=http://localhost:5173
STABLE_RPC_URL=https://rpc.testnet.stable.xyz
SESSION_ENCRYPTION_KEY=<64 hexadecimal characters>
FUNDING_PRIVATE_KEY=<dedicated funded testnet private key>
SELLER_ADDRESS=<your nonzero testnet recipient address>
GLOBAL_FUNDING_CAP_USDT0=10
```

Generate the encryption key with `openssl rand -hex 32`. Keep this key stable across restarts and back it up with the private database. Use a dedicated testnet funding wallet and fund it through your approved testnet funding source. This repository neither supplies a shared signer nor assumes faucet access.

```sh
npm run check:network
npm run dev
```

The network check verifies the released Stable SDK's testnet chain and token address against RPC. Native amounts use 18 decimals; the ERC-20 view uses 6 decimals. These are two representations of the same asset, never balances to add together.

Opening **Try it out** provisions a bounded session. Only **Run the demo** authorizes the displayed quote. Each wallet receives 1 test USDT0 by default; its cumulative spending limit is 0.05 USDT0 including fees. The price is 0.01 USDT0 and the maximum fee is 0.01 USDT0. These are configurable policy values, not claims about prevailing network fees.

## Verify and build

```sh
npm test
npm run build
npx playwright install chromium
npm run test:browser
npm run test:live
# Explicitly authorize one additional funded browser purchase:
LIVE_BROWSER_TEST=1 npm run test:live:browser
```

Live verification requires configured testnet funding. See the [acceptance record](/docs/acceptance/) for what has actually been verified. See [agent setup](/docs/agent-setup/) to reproduce outside the browser, [accept payments](/docs/accept-payments/) for the seller, and [deployment](/docs/deployment/) for hosting.
