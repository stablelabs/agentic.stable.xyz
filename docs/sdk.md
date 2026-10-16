# Owner SDK

`@stablechain/agent-wallet-sdk` exposes Alice's owner operations as a browser-compatible TypeScript library over `viem`. The [web app](../packages/web) uses this SDK. Wallet discovery, forms, connection prompts, React state, storage, and private-key management belong to the consuming app.

## Install

```sh
npm install @stablechain/agent-wallet-sdk@0.1.2 viem
```

The package exports ESM JavaScript and TypeScript declarations. `viem` is a peer dependency; neither the main entry nor `@stablechain/agent-wallet-sdk/protocol` imports Node filesystem APIs or React. The main entry provides `createOwnerClient`, operation types/errors, and presentation helpers. The protocol entry exposes ABIs, amount parsing, verification, grant readers, gas, and receipt helpers for lower-level consumers.

For local development, run from the repository root with Node.js 22+:

```sh
npm ci
npm run build:sdk
npm pack ./packages/sdk
# In a separate application, install the generated tarball and viem.
npm install /path/to/stablechain-agent-wallet-sdk-0.1.2.tgz viem
```

Packing rebuilds the SDK and does not publish it. To test both local packages together, build tools and install both generated tarballs into the consumer so its CLI resolves the matching SDK. See [releases](releases.md) before publishing.

## Create an owner client

Obtain a verified [public WalletConfig](wallet.md#public-wallet-configuration) from the operator. Reads and transaction preparation do not require a wallet client:

```ts
import { createOwnerClient, publicClient, type WalletConfig } from '@stablechain/agent-wallet-sdk';

export async function inspectWallet(config: WalletConfig) {
  const owner = createOwnerClient({ config, publicClient: publicClient(config.rpcUrl) });
  await owner.verifyAccount();
  return owner.listGrants({ limit: 20 });
}
```

The factory validates configuration. Reads such as `getGrant`, `listGrants`, and `getBalances` do not automatically call `verifyAccount`; verify the account explicitly before presenting it as trusted. Preparation and submission verify it again.

For mutations, supply a `viem` wallet client connected to Alice on Stable Testnet and a persistence hook supplied by your application:

```ts
import { createOwnerClient, newGrantId, type OwnerOperation } from '@stablechain/agent-wallet-sdk';

const owner = createOwnerClient({
  config,
  publicClient,  // Injected viem public client for config.rpcUrl.
  walletClient,  // Injected viem wallet client connected to Alice.
  onOperation: async (operation: OwnerOperation) => {
    await operationStore.save(operation);
  },
});

const grantId = newGrantId(); // Persist this ID with the form before requesting approval.
const operation = await owner.createGrant({
  id: grantId,
  agent: agentAddress,
  recipient: recipientAddress,
  budget: '0.01',
  expires: '2030-01-01T00:00:00Z',
});
const confirmation = await owner.wait(operation, { timeout: 120_000 });
if (!confirmation.success) throw new Error('Grant creation reverted.');
```

Keep the grant ID stable across owner rejection or uncertain submission. New grants start Active. Grant administration targets the pinned implementation's owner forwarder, matching the MetaMask path; gas funding targets the grant's agent directly. The SDK never submits grant requests as the agent.

## API

| Method | Result |
| --- | --- |
| `verifyAccount()` | Verify chain 2201, token metadata, pinned bytecode, EIP-7702 delegation, and wallet v3. |
| `getBalances(agent?)` | Alice's token balance and the selected agent's native balance, with decimals and an observation block/time. Defaults to `config.defaultAgent`; agent balance is absent when neither is supplied. |
| `getGrant(id, blockNumber?)` | Grant terms, derived status, remaining budget, and observation block/time. |
| `listGrants({ limit?, cursor?, agent?, status?, maxScan? })` | A bounded page, newest first. Defaults to all agents, unlike the CLI; supply `agent` to filter. Limit defaults to 20 and permits 1–100; maxScan defaults to 200 and must be between the limit and 1000. |
| `prepareCreateGrant(terms)` / `createGrant(terms)` | Prepare without signing, or submit owner authorization. Supply an explicit nonzero ID, signer, recipient, positive decimal budget, and future UTC expiry string. |
| `prepareRevokeGrant(id)` / `revokeGrant(id)` | Prepare or submit owner revocation. |
| `estimateAgentGas(id)` | Native balance, buffered payment reserve, and suggested top-up. An unavailable estimate rejects; it is not proof of readiness. |
| `prepareFundAgentGas({ grantId, amount })` / `fundAgentGas(...)` | Prepare or submit a separate native transfer to the exact agent of an Active grant. The decimal amount accepts at most six fractional digits. |
| `send(preparedOperation)` | Revalidate the owner, chain, and intent, reconstruct the permitted transaction, and submit. A serialized `request` cannot override its destination or calldata. |
| `wait(operation, options?)` | Observe a saved hash and verify its exact action without resubmitting. Options use milliseconds for `timeout` and `pollingInterval`, plus `confirmations` (default 1). Timeout defaults to 120,000 ms. |
| `legacy.approveGrant(id)` / `legacy.rejectGrant(id)` | Owner actions for migrated Pending grants. |

Continue listings with the returned cursor and the same filters. The cursor retains a block snapshot; a bounded scan can yield no matching items while still returning a cursor. Status derives from chain time and spending: `Unknown`, `Pending`, `Active`, `Rejected`, `Revoked`, `Expired`, or `Exhausted`.

Read and estimate results use `bigint` for atomic amounts and chain observations; convert those values before JSON serialization. New `OwnerOperation` descriptors are JSON-safe and include an operation ID, action, chain, Alice, implementation, grant ID, normalized intent, status, and a hash once returned. Grant budgets use six-decimal token units; native funding uses eighteen-decimal atomic units internally. Revoking a grant does not recover a prior top-up.

## Persistence and recovery

The awaited `onOperation` hook runs before the wallet submission request, after a returned hash, and after a verified receipt. A failed hook before submission prevents the wallet request. If persistence fails after submission, `OwnerOperationError.operation` retains the returned hash. Persist descriptors without discarding unresolved operations when a newer operation starts.

Each submission checks the current owner and wallet chain even if previously connected. A client instance rejects concurrent submissions and reuse of an attempted operation after a submitted or unknown outcome, including reuse of its original prepared object. This guard is in memory: your application must persist and gate unresolved operations across client instances and reloads. The existing web app does this for gas funding.

Reload an operation and observe it without a signing wallet:

```ts
const saved: OwnerOperation = await operationStore.load();
const observer = createOwnerClient({ config, publicClient });
const result = await observer.wait(saved);
```

`wait` returns `success: true` and a `confirmed` operation only after the exact grant event or gas-funding sender, recipient, value, and empty calldata match. An included revert returns `success: false` and a `reverted` operation. A timeout, cancellation, different-action replacement, or missing matching event throws `OPERATION_UNVERIFIED`; retain the operation for investigation. Same-action repricing can update its confirmed hash.

| Error | Caller action |
| --- | --- |
| `OWNER_WALLET_REQUIRED` / `OWNER_MISMATCH` | Connect Alice on Stable Testnet before submitting. |
| `OWNER_BUSY` | Wait for the current wallet submission request to finish. |
| `OWNER_REJECTED` | The wallet explicitly rejected submission. Retain the draft and request approval again only when intended. |
| `SUBMISSION_OUTCOME_UNKNOWN` | Reconcile the saved intent with wallet history before retrying. |
| `PERSISTENCE_FAILED` | Inspect `error.operation`; preserve its hash if present. |
| `ALREADY_SUBMITTED` | Observe or reconcile the original operation instead of sending it again. |
| `NOT_SUBMITTED` | No hash is available to observe. Check wallet history if submission was unknown. |
| `OPERATION_UNVERIFIED` | Retain the hash/intent and check confirmation or the exact onchain action. |

Errors extend `WalletError` with a symbolic `code`; `OwnerOperationError` also carries the operation. If an unknown wallet outcome has no hash, find the correct transaction in wallet history, attach its hash to the saved descriptor, and call `wait`. The SDK verifies the action. The web app provides this recovery field for unknown gas funding. The SDK does not have the wallet's raw signed bytes and cannot provide the CLI's identical-byte rebroadcast guarantee.

Account activation and upgrades remain in the [operator setup](wallet.md#1-set-up-alice-and-the-agent). Agent payment signing and its durable journal belong to the [CLI](cli.md).
