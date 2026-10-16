# Agent wallet SDK

Browser-compatible owner operations and shared wallet protocol. This package owns its TypeScript source, declarations, and build output. Both `agent-wallet-web` and `@stablechain/agent-wallet-cli` declare it as a dependency.

```sh
npm install @stablechain/agent-wallet-sdk@0.1.0 viem
```

```sh
npm run build --workspace @stablechain/agent-wallet-sdk
npm run test --workspace @stablechain/agent-wallet-sdk
```

Apps import `createOwnerClient` and public wallet helpers from `@stablechain/agent-wallet-sdk`. The CLI and operator tools use the `@stablechain/agent-wallet-sdk/protocol` entry for ABI, verification, amount, gas, and receipt functions. Neither entry imports Node filesystem APIs or React.

The public npm package includes compiled JavaScript, declarations, this README, and its manifest. The prepack hook rebuilds the package before packing or publishing.
