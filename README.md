# Agent Wallet

The application in this repository is an EIP-7702 agent wallet proof of concept on Stable Testnet. Alice keeps her existing address and creates spending grants through Chrome MetaMask. The agent signs payments locally, subject to onchain recipient, budget, expiry, and payment ID checks.

Alice creates grants and can fund the agent for gas in the app. The agent pays payment gas from its own balance. Private keys stay local.

## Run locally

Use Node.js 22+ and [Foundry](https://getfoundry.sh/introduction/installation). Run all commands from this repository root:

```sh
npm ci
umask 077
cp -n agent-wallet/.env.alice.example agent-wallet/.env.alice.local
```

For a fresh setup, add Alice's fresh test-only private key to `ALICE_PRIVATE_KEY` in `agent-wallet/.env.alice.local`, then run:

```sh
npm run contracts
npm run wallet:enable
npm run wallet:init-agent
npm run dev
```

For an existing setup, retain the local key and `.agent-wallet/` state and run `npm run dev`. Open [http://localhost:5174](http://localhost:5174) in Chrome. Connect Alice, create a grant, and fund the agent for gas if the app indicates it is needed.

See the [wallet guide](agent-wallet/README.md) for account upgrades, payment commands, recovery, and live testnet acceptance.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the wallet app on port 5174 |
| `npm run build` | Type-check and build the wallet app |
| `npm run preview` | Serve the production build locally |
| `npm run contracts` | Compile the Solidity contracts |
| `npm test` | Compile contracts and run client/script tests using Anvil |
| `npm run test:contracts` | Run the Foundry contract suite |
| `npm run test:browser` | Run browser tests |
| `npm run wallet:pay -- --grant … --recipient … --amount …` | Submit an agent-signed payment |

The existing `wallet:*` commands remain available. Application source, contracts, clients, scripts, and tests live under `agent-wallet/`; root files provide npm and TypeScript tooling. `.agent-wallet/` holds ignored local keys, configuration, and transaction journals. The production build is generated in `agent-wallet/app/dist/`.

This is test-only code. Mainnet, gas sponsorship, and per-purchase approvals are outside its scope.

## Cloudflare deployment

The existing Worker is `agentic-stable`, at [agentic-stable.angela-f4b.workers.dev](https://agentic-stable.angela-f4b.workers.dev). Deploy from the repository root with the existing Cloudflare account login:

```sh
npm run deploy:cloudflare
```

This builds the wallet, generates Worker types, and replaces the build's browser configuration with the versioned public settings in `agent-wallet/deployment/wallet-config.json`. The default `npm run build` uses these same settings, so a fresh Git checkout produces a configured demo. No local key or transaction journal is read or uploaded. Update that public configuration when deploying a different Alice account or implementation.

For Cloudflare Workers Builds connected to this repository, use Node 22+, root directory `/`, build command `npm run build:cloudflare`, and deploy command `npx wrangler deploy`. Those settings are managed in Cloudflare's dashboard; the Wrangler configuration identifies the existing Worker and its account.

The small `FundingLedger` export and its existing migration retain the retired demo's Cloudflare storage. The wallet serves static assets and does not access that ledger or expose the former payment API. Do not delete the namespace or add a deletion migration as part of routine deployment.
