# Agent wallet SDK

Browser-compatible owner operations and shared wallet protocol. This package owns its TypeScript source, declarations, and build output. Both `agent-wallet-web` and `agent-wallet-cli` declare it as a dependency.

```sh
npm run build --workspace agent-wallet-sdk
npm run test --workspace agent-wallet-sdk
```

Apps import `createOwnerClient` and public wallet helpers from `agent-wallet-sdk`. The CLI and operator tools use the `agent-wallet-sdk/protocol` entry for ABI, verification, amount, gas, and receipt functions. Neither entry imports Node filesystem APIs or React.

The package includes only `dist` and this README when packed. It remains private; local builds and packing do not publish it.
