# Agent wallet CLI

The `agent-wallet` executable manages the local agent signer, grants, payments, and recovery on Stable Testnet. Wallet protocol code comes from its declared `@stablechain/agent-wallet-sdk` dependency.

Install with Node.js 22 or newer:

```sh
npm install --global @stablechain/agent-wallet-cli@0.1.1
agent-wallet --help
```

Or run directly:

```sh
npx --yes --package=@stablechain/agent-wallet-cli@0.1.1 agent-wallet --help
```

Each agent initializes its own signer and imports owner-provided public wallet settings. Set `WALLET_STATE_DIR` to a persistent private directory, especially in containers:

```sh
agent-wallet init --json
agent-wallet config import --file ./wallet-config.json --json
agent-wallet whoami --json
agent-wallet grants link --recipient "$RECIPIENT" --budget 0.01 --expires-in 24h --json
```

The owner reviews the approval link, authorizes the grant, and funds the agent's gas through the approval UI. The CLI does not activate the owner's account or read the owner's key. Payments require a stable payment ID; recover an uncertain submission by reusing that ID and its saved journal. See the [CLI reference](https://github.com/stablelabs/agentic.stable.xyz/blob/main/docs/cli.md) for the command surface, JSON output, permissions, and recovery workflow.

For repository development:

```sh
npm run build:sdk
npm run build --workspace @stablechain/agent-wallet-cli
npm run wallet -- --help
npm run test --workspace @stablechain/agent-wallet-cli
```

The package compiles its own `src` into `dist`, exposes `dist/main.js` as the executable, and exports Node-only services through `@stablechain/agent-wallet-cli/agent` for the repository's compatibility scripts. It does not copy SDK source or bundle private signing state.

The public npm package includes compiled JavaScript, declarations, this README, and its manifest. The prepack hook rebuilds the package before packing or publishing. The SDK is a separate public dependency; React and the repository's build tools are not runtime dependencies.
