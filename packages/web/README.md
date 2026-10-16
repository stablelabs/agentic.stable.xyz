# Agent wallet web app

React and Vite app for Alice's wallet. All owner operations and wallet helpers are imported from the declared `@stablechain/agent-wallet-sdk` dependency. The UI owns wallet connection, forms, browser storage, and presentation.

```sh
npm run build:sdk
npm run dev --workspace agent-wallet-web
npm run build --workspace agent-wallet-web
npm run test --workspace agent-wallet-web
```

Build the SDK first after a fresh install. During SDK development, run `npm run dev:sdk` in another terminal to rebuild its exports as source changes.

Development uses port 5174. Browser tests use port 5175 by default; set `WALLET_TEST_PORT` to choose another test port.

`deployment/wallet-config.json` contains the public production account settings. The build copies only that allowlisted configuration into `dist`. Repo-level operator scripts write local public settings to `public/wallet-config.json` for development. Cloudflare's root configuration serves this package's `dist` and uses `deployment/worker.ts` as its entry.
