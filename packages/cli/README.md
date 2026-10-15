# Agent wallet CLI

The `agent-wallet` executable manages the local agent signer, grants, payments, and recovery on Stable Testnet. Wallet protocol code comes from its declared `agent-wallet-sdk` dependency.

```sh
npm run build:sdk
npm run build --workspace agent-wallet-cli
npm run wallet -- --help
npm run test --workspace agent-wallet-cli
```

The package compiles its own `src` into `dist`, exposes `dist/main.js` as the executable, and exports Node-only services through `agent-wallet-cli/agent` for the repository's compatibility scripts. It does not copy SDK source or bundle private signing state.

Both the CLI and SDK can be packed and installed together in a separate application. This package remains private.
