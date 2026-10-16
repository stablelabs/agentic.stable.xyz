# Agent wallet contracts

Solidity implementation and Foundry tests for the EIP-7702 wallet on Stable Testnet. This workspace owns `src/AgentWallet.sol`, contract tests, and v1/v2 migration fixtures. It has no dependency on the web app, CLI, or SDK.

Install [Foundry](https://getfoundry.sh/introduction/installation), using version 1.5.1 to match release CI. With Node.js 22+ and `npm ci` completed, run from the repository root:

```sh
npm run build --workspace agent-wallet-contracts
npm run test --workspace agent-wallet-contracts
npm run check --workspace agent-wallet-contracts
npm run format --workspace agent-wallet-contracts
```

`foundry.toml` pins Solidity 0.8.30, the Prague EVM, Stable Testnet chain ID 2201, and 256 fuzz cases. Set `WALLET_SOLC=/path/to/solc-0.8.30` to use a separately installed compiler. Extra Foundry options can follow `--`, for example `npm run test --workspace agent-wallet-contracts -- --match-test testActivationAtExistingAddress`.

Foundry writes ignored artifacts to `out/` and its build cache to `cache/`. Root operator scripts load deployment bytecode from this package's `out/AgentWallet.sol/AgentWallet.json`; `npm test` builds those artifacts before integration tests. Retain the original artifacts and private deployment journals when recovering an interrupted deployment.

The current implementation reports `VERSION = 3`. New owner-created grants start Active; v1/v2 fixtures test storage compatibility, including legacy Pending grants, spending, and account-wide payment IDs. Contract tests cover forwarding, grant policy, transfer rollback, and cumulative-budget fuzzing. Run browser and integration tests separately through the root scripts.

This private workspace is not published to npm. See the [wallet guide](../../docs/wallet.md) for activation, grant rules, and recovery. The SDK maintains the browser-compatible [ABI](../sdk/src/client/abi.ts); update it alongside any contract interface change, then run the [repository checks](../../docs/wallet.md#checks).
