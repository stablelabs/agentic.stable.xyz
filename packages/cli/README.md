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
export WALLET_STATE_DIR="$HOME/.local/share/stable-agent-wallet"
agent-wallet init --json
agent-wallet config import --file ./wallet-config.json --json
agent-wallet whoami --json
agent-wallet grants link --recipient "$RECIPIENT" --budget 0.01 --expires-in 24h --json
```

Obtain `wallet-config.json` from the owner or operator after account activation. Import verifies the network, pinned implementation, and account delegation; it does not grant spending permission. The owner reviews the approval link, authorizes the grant, and funds the agent's gas through the approval UI.

Payments require a stable payment ID. Use `payments prepare` to save one, then `pay --payment-id ID` to submit it. Recover an uncertain submission with `payments wait ID` or `payments resume ID`, retaining the same ID and journal. State contains a plaintext signer key and signed transactions; use one private, persistent directory per signer. The CLI does not activate the owner's account or read the owner's key.

Every command supports `--json` with a versioned result envelope and symbolic errors. Check `data.status` to distinguish submission from confirmation; `doctor` returns diagnostics in `data.checks` and `data.ready`. See the [CLI reference](https://github.com/stablelabs/agentic.stable.xyz/blob/main/docs/cli.md) for commands, exit codes, public configuration, and recovery.

For repository development:

```sh
npm ci
npm run build:sdk
npm run build --workspace @stablechain/agent-wallet-cli
npm run wallet -- --help
npm run test --workspace @stablechain/agent-wallet-cli
```

The package compiles its own `src` into `dist`, exposes `dist/main.js` as the executable, and exports Node-only services through `@stablechain/agent-wallet-cli/agent` for the repository's compatibility scripts. It does not copy SDK source or bundle private signing state.

The public npm package includes compiled JavaScript, declarations, this README, and its manifest. The prepack hook rebuilds the package before packing or publishing. The SDK is a separate public dependency; React and the repository's build tools are not runtime dependencies.

The CLI and SDK are published together from matching version tags, using GitHub Actions trusted publishing. See the [release guide](https://github.com/stablelabs/agentic.stable.xyz/blob/main/docs/releases.md).
