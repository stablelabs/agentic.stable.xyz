# Owner SDK

`@stablechain/agent-wallet-sdk` exposes Alice's owner operations as a browser-compatible TypeScript library over `viem`. The existing app uses this SDK. Wallet discovery, forms, React state, storage, and private-key management remain in the consuming app.

## Build and install locally

```sh
npm run build:tools
npm pack ./packages/sdk
# In a separate application, install the generated tarball and viem.
npm install /path/to/stablechain-agent-wallet-sdk-0.1.1.tgz viem
```

The package exports JavaScript and TypeScript declarations, with `viem` as its peer dependency. It contains only the SDK and shared protocol modules, with no Node filesystem imports or React dependency.

## Create an owner client

```ts
import { createOwnerClient, newGrantId, type OwnerOperation } from '@stablechain/agent-wallet-sdk';

const owner = createOwnerClient({
  config,        // Operator-provided public WalletConfig
  publicClient,  // viem public client
  walletClient,  // viem wallet client connected to Alice
  onOperation: async (operation: OwnerOperation) => {
    await operationStore.save(operation); // Storage is supplied by your app.
  },
});

await owner.verifyAccount();
const operation = await owner.createGrant({
  id: newGrantId(),
  agent: agentAddress,
  recipient: recipientAddress,
  budget: '0.01',
  expires: '2030-01-01T00:00:00Z',
});
const confirmation = await owner.wait(operation, { timeout: 120_000 });
if (!confirmation.success) throw new Error('Grant creation reverted.');
```

Keep the grant ID stable across a rejected request or an uncertain submission. Grant administration goes to the pinned implementation's owner forwarder, matching the MetaMask path. New grants start Active; the SDK never submits grant requests as the agent.

## API

| Method | Result |
| --- | --- |
| `verifyAccount()` | Verify Stable Testnet, token metadata, pinned bytecode, delegation, and v3. |
| `getBalances(agent?)` | Alice's token balance and the selected agent's native balance, with explicit decimals and an observation block. |
| `getGrant(id, blockNumber?)` | Grant, derived status, remaining budget, and observation block/time. |
| `listGrants({ limit?, cursor?, agent?, status?, maxScan? })` | A bounded page of grants and a continuation cursor. |
| `prepareCreateGrant(terms)` / `createGrant(terms)` | Prepare without signing, or submit owner authorization. Terms use exact decimal budget and UTC expiry strings. |
| `prepareRevokeGrant(id)` / `revokeGrant(id)` | Prepare or submit owner revocation. |
| `estimateAgentGas(id)` | Native agent balance, buffered payment reserve, and suggested top-up; reject unavailable estimates. |
| `prepareFundAgentGas({ grantId, amount })` / `fundAgentGas(...)` | Prepare or submit a separate native transfer to the grant's exact agent. Amount accepts at most six decimals. |
| `send(preparedOperation)` | Revalidate owner, chain, and intent; reconstruct the allowed transaction and submit it. |
| `wait(operation, options?)` | Observe the saved hash and verify the exact action; never resubmit. Options include timeout, polling interval, and confirmation count. |
| `legacy.approveGrant(id)` / `legacy.rejectGrant(id)` | Owner actions for migrated Pending grants. |

Reads and preparation do not require `walletClient`. Each submission checks the current wallet account and network, even if previously connected. SDK instances reject concurrent wallet submissions. The app should also gate unresolved funding across sessions, as the existing app does.

## Persistence and recovery

Mutation methods return a JSON-safe `OwnerOperation` with a unique operation ID, action, chain, Alice, implementation, normalized intent, status, and transaction hash. An SDK instance refuses reuse of an operation already requested, including reuse of its original prepared object. Persist the current descriptor and gate unresolved operations across client instances and page reloads. The awaited `onOperation` hook runs before requesting submission, after receiving a hash, and after observation. A failed hook before submission prevents the wallet request. `OwnerOperationError.operation` retains a returned hash even if subsequent persistence fails.

```ts
const saved = await operationStore.load();
const observer = createOwnerClient({ config, publicClient });
const result = await observer.wait(saved);
```

Successful receipts must prove the exact grant creation/status event or exact gas-funding sender, recipient, value, and empty calldata. A timeout, cancellation, replacement with another action, or missing event stays unverified. `wait` accepts a reloaded descriptor without a connected signing wallet.

If wallet submission fails without returning a hash, `OwnerOperationError` distinguishes owner rejection from an unknown outcome and carries the intent. For an unknown outcome, reconcile with the wallet's history before retrying. Once the correct hash is found, attach it to that operation and call `wait`; the SDK verifies its terms. The browser app provides this recovery field for unknown gas funding. The SDK does not have the connected wallet's raw signed bytes, so it cannot provide the CLI's identical-byte rebroadcast guarantee.

Budgets use six-decimal token units. Gas transfers use eighteen-decimal native units internally. They are separate operations; revoking a grant does not return a prior gas top-up. Account activation and upgrades remain in the existing [operator setup](../README.md#1-set-up-alice-and-the-agent).
