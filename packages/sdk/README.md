# Agent wallet SDK

Browser-compatible TypeScript owner operations for Agent Wallet on Stable Testnet. Create and revoke grants, estimate and fund the agent's gas, and verify transaction outcomes using injected `viem` clients. The repository's web app uses this SDK; the agent CLI consumes its shared protocol entry.

```sh
npm install @stablechain/agent-wallet-sdk@0.1.1 viem
```

`viem` is a peer dependency. The SDK includes compiled ESM JavaScript and TypeScript declarations, with no React, Node filesystem, private-key storage, or Solidity compiler dependency.

```ts
import { createOwnerClient, publicClient, type WalletConfig } from '@stablechain/agent-wallet-sdk';

// Obtain these public settings from the account operator.
export async function inspectWallet(config: WalletConfig) {
  const owner = createOwnerClient({ config, publicClient: publicClient(config.rpcUrl) });
  await owner.verifyAccount();
  return owner.listGrants({ limit: 20 });
}
```

Supply a connected Alice `walletClient` to submit owner operations. Reads and preparation work without it. Persist `OwnerOperation` descriptors through `onOperation`; after a timeout, observe the saved operation with `wait` instead of submitting another transaction. Read results can contain `bigint`; operation descriptors use JSON-safe strings.

See the [SDK reference](https://github.com/stablelabs/agentic.stable.xyz/blob/main/docs/sdk.md) for the full API, public configuration, units, and persistence contract. Activation and EIP-7702 upgrades use the repository's operator setup.

## Repository development

From the repository root after `npm ci`:

```sh
npm run build --workspace @stablechain/agent-wallet-sdk
npm run test --workspace @stablechain/agent-wallet-sdk
```

Apps import owner operations from `@stablechain/agent-wallet-sdk`. The `@stablechain/agent-wallet-sdk/protocol` entry exposes lower-level ABI, verification, amount, gas, grant-reading, and receipt functions for the CLI and operator tools. Both entries are browser compatible.

The prepack hook rebuilds the package. Its npm artifact contains compiled JavaScript, declarations, this README, and its manifest. SDK and CLI releases use a shared version; see the [release guide](https://github.com/stablelabs/agentic.stable.xyz/blob/main/docs/releases.md).
