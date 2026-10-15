# Agent wallet CLI and owner SDK implementation plan

The CLI and owner SDK are implemented. See the [CLI reference](cli.md) and [SDK reference](sdk.md) for current usage. This plan records their scope and design.

Create two interfaces over the same wallet protocol: an `agent-wallet` CLI for software that spends under Alice's grants, and a lightweight TypeScript SDK for Alice's account and grant management. The CLI handles agent identity, approval links, permission discovery, payments, and recovery. The Alice SDK handles wallet verification, grant creation and revocation, gas funding, and confirmation; the existing browser app becomes its first consumer.

The existing TypeScript client and onchain checks form the shared foundation. The commands and SDK API below define the implementation scope. The original `npm run wallet:*` scripts remain compatible adapters, and the browser consumes the owner SDK.

## What the agent side does today

Alice owns an EIP-7702 account. She enables the implementation locally, then creates and revokes grants through MetaMask. A grant permits one agent signer to transfer USDT0 to one recipient, within a cumulative budget and before expiry. The agent signs a `pay` call directly to Alice's account. Alice supplies the payment funds; the agent supplies gas.

There is no AI model or autonomous decision loop in this repository. The CLI supplies payment tools that a human, shell script, or external agent runtime can call. Cloudflare serves the approval UI and public configuration; it does not execute agent payments.

| Existing component | Behavior to preserve or reuse |
| --- | --- |
| [Overview](../README.md) and [wallet guide](wallet.md) | Owner and agent responsibilities, cumulative budgets, separate gas funding, and recovery instructions. |
| [init-agent.ts](../scripts/init-agent.ts) | Generates a separate signer, retains an existing key, and updates the local browser configuration when available. |
| [grant-link.ts](../scripts/grant-link.ts) | Validates terms and prints a public approval URL. It signs and submits nothing. |
| [request-grant.ts](../scripts/request-grant.ts) | Explicitly retires agent-submitted grant requests. New grants are owner-created and immediately Active. |
| [pay.ts](../scripts/pay.ts) | Parses exact amounts, binds a payment ID to immutable terms, saves the intent, verifies the account, simulates, and submits. |
| [local.ts](../scripts/local.ts) | Private local files, atomic durable writes, a command lock, agent signing, and journaled submission. Signed bytes and their hash are saved before broadcast. |
| [client.ts](../packages/sdk/src/client/client.ts) and [abi.ts](../packages/sdk/src/client/abi.ts) | Network and delegation verification, grant reads, derived statuses, transaction tracking, and exact receipt event checks. |
| [gas.ts](../packages/sdk/src/client/gas.ts) and [amount.ts](../packages/sdk/src/client/amount.ts) | Gas reserve and funding estimates, integer arithmetic, and rejection of payment amounts with more than six decimals. |
| [AgentWallet.sol](../packages/contracts/src/AgentWallet.sol) | Authoritative signer, recipient, status, expiry, budget, and duplicate-ID checks. Successful payment IDs are unique across Alice's account. |
| [App.tsx](../packages/web/src/App.tsx) | Owner operations to extract into the Alice SDK, plus grant reads at one block, pagination, and MetaMask interaction. |
| [Script tests](../tests/scripts.test.ts), [client tests](../packages/sdk/tests/client.test.ts), and [gas tests](../packages/sdk/tests/gas.test.ts) | Anvil integration, repeated-payment recovery, amount precision, account verification, replacements, and gas behavior. |
| [enable-account.ts](../scripts/enable-account.ts) and [live-acceptance.ts](../scripts/live-acceptance.ts) | Separate operator setup and developer acceptance workflows. These should remain outside the agent command surface. |

Both interfaces already exist in pieces. The main work is extracting reusable operations and giving the CLI and SDK consistent intent, verification, and outcome contracts. Version 1 needs no Solidity changes or hosted agent service.

## Lightweight owner SDK

Provide a small browser-compatible TypeScript library built on `viem`, with injected public and wallet clients. Reads and transaction preparation work without a wallet client; submission requires Alice's connected wallet. Keep React components, wallet discovery, connection prompts, local storage, Node filesystem access, and private-key management in the consuming application or operator adapter.

Expose a role-based factory named `createOwnerClient`; Alice is the example owner, not a name applications need to adopt. Start with the functions the current UI needs. The SDK provides typed operations over the wallet protocol, while applications choose their interface and storage. It does not need an agent runtime, hosted API, background process, or UI framework.

| SDK method | Behavior |
| --- | --- |
| `verifyAccount()` | Verify the network, token, pinned implementation, delegation, and wallet version. Return typed setup errors for an account that needs activation or upgrade. |
| `getBalances()` | Return Alice's token balance and the selected agent's native gas balance with explicit units and observation block. If exposing Alice's native balance too, label it as another representation of the same funds rather than an additional balance to sum. |
| `getGrant(id)` / `listGrants(options)` | Read grant terms, derived status, remaining budget, and paginated results using the same shared readers as the CLI. |
| `prepareCreateGrant(terms)` / `createGrant(terms)` | Validate an explicit grant ID, signer, recipient, exact decimal budget, and UTC expiry. Prepare or submit `createGrantFor` to the implementation; Alice reviews the transaction in her wallet. |
| `prepareRevokeGrant(id)` / `revokeGrant(id)` | Read the current grant and prepare or submit `revokeGrantFor` through the implementation. Revocation takes effect when included onchain. |
| `estimateAgentGas(grantId)` | Return the agent balance, estimated payment reserve, and suggested top-up using the existing gas helpers. Estimation failure is an unavailable result. |
| `prepareFundAgentGas(input)` / `fundAgentGas(input)` | Require a grant ID and an explicit decimal amount. Verify its agent and Active status, then prepare or submit a separate native transfer from Alice. Do not combine funding with grant authorization. |
| `send(preparedOperation)` | Submit a previously prepared operation after rechecking the connected owner, wallet chain, configured account, and current preconditions. Keep the reviewed intent fixed; refresh dynamic gas and fee estimates as needed. |
| `wait(operation, options)` | Observe a submitted operation with a bounded timeout and verify the exact action. Preserve repricing, reject cancellation or replacement with another action, and distinguish submission from confirmation. |
| `legacy.approveGrant(id)` / `legacy.rejectGrant(id)` | Keep compatibility with migrated Pending grants, using the existing owner forwarders. New grants are created Active. |

Illustrative API, with a provisional package import name:

```ts
import { createOwnerClient } from 'agent-wallet-sdk';

const owner = createOwnerClient({
  config,                    // Public account and implementation settings
  publicClient,              // Injected viem RPC client
  walletClient,              // Injected connected owner wallet
  onOperation: persistOperation,
});

await owner.verifyAccount();

const creation = await owner.createGrant({
  id: grantId,                // Stable ID supplied by the app or approval link
  agent: agentAddress,
  recipient: recipientAddress,
  budget: '0.01',
  expires: '2030-01-01T00:00:00Z',
});
await owner.wait(creation);

const gas = await owner.estimateAgentGas(grantId);
// Display the estimate; Alice chooses the amount and confirms a separate transfer.
const funding = await owner.fundAgentGas({ grantId, amount: '0.01' });
await owner.wait(funding);

const revocation = await owner.revokeGrant(grantId);
await owner.wait(revocation);
```

Mutation methods return a serializable operation descriptor as soon as the wallet returns a transaction hash. It includes the chain, Alice, implementation, action, normalized intent, and hash. The caller can persist and reload it for `wait`; successful grant creation requires the exact `GrantCreated` event, revocation requires the exact status event, and funding requires the matching sender, recipient, native value, and empty calldata. Reuse `creationCheck`, `statusCheck`, and `trackGasFunding` for these checks.

An awaited `onOperation` hook lets the app persist the intent before requesting wallet submission, then persist the returned hash and later outcome. Keep the storage implementation outside the SDK. A timeout after submission preserves the operation for observation. If wallet submission fails ambiguously before returning a hash, return the saved intent with an unknown outcome and require reconciliation with the wallet's transaction history. The SDK does not possess the wallet's signed bytes and must not claim the CLI's raw-transaction recovery guarantee or automatically request another funding transfer. A failed persistence hook after a returned hash must surface that hash in the error result.

Check the wallet's current owner address and chain before each submission, even if the app previously connected successfully. Route grant administration to the implementation's `*For` methods, matching the current MetaMask-compatible path. Route gas funding directly to the agent. The SDK keeps budgets as exact decimal inputs and integer atomic values internally; funding and payment amounts retain their distinct native and token units.

Prepared operations contain typed, normalized intent; `send` reconstructs the permitted transaction from that intent and verifies the configured account instead of trusting caller-supplied calldata or destinations. Serialize wallet submission requests within a client instance. The app persists unresolved operations and retains the existing guard against another gas top-up while funding is unverified, including after reload. Keep this persistence contract explicit rather than adding hidden browser storage to the SDK.

Account activation and upgrades remain an explicit setup boundary in version 1. The lightweight SDK reports the required setup and exposes verification; the existing `wallet:enable` script performs deployment and EIP-7702 authorization. A future optional setup adapter can extract that flow for signers that support it, without putting Solidity artifacts or owner key files into the browser SDK.

Migrate the existing UI to call the SDK for reads, creation, revocation, legacy actions, funding, and confirmation. The app retains MetaMask discovery, account-change listeners, forms, transaction notices, and operation persistence. Export only browser-safe modules with TypeScript declarations and `viem` as a peer dependency; the SDK package must not pull in the CLI's filesystem, keys, or operator tooling.

## Proposed command interface

Use `agent-wallet` as the binary name, matching the current package. Commands run without a browser or prompts; commands that need owner action return an approval URL.

```text
agent-wallet
  init                         Create or verify the local agent signer
  whoami                       Show its public address and selected state directory
  config import --file FILE    Import and verify public wallet configuration
  config show                  Show allowlisted public configuration
  status                       Show account, balances, and unresolved payments
  doctor                       Diagnose local state and account setup

  grants link                  Save grant terms and return Alice's approval URL
  grants list                  Discover grants for the local agent
  grants show GRANT_ID          Show terms, status, and remaining budget
  grants wait GRANT_ID          Wait for authorization and check saved terms

  gas check --grant GRANT_ID    Show the agent balance and estimated reserve

  payments prepare             Save a new payment intent and return its ID
  pay --payment-id PAYMENT_ID   Submit a new or saved intent
  payments list                List local payment records
  payments show PAYMENT_ID     Inspect one record without broadcasting
  payments wait PAYMENT_ID     Check confirmation without broadcasting
  payments resume PAYMENT_ID   Continue the same saved intent

  --help  --version  --json  --state-dir DIR
```

| Command | Inputs and behavior |
| --- | --- |
| `init` | Idempotent. Validate an existing key and its recorded address; never replace it automatically. Creating a signer does not require Alice's private key or configuration. |
| `config import` | Accept a local public configuration file from the operator. Apply `validateConfig` and `verifyAccount` before saving it. Treat import as selecting Alice and the pinned implementation, not as authorizing a grant. Reject a change of account while the directory contains payment records; use another state directory. |
| `status` | Show the configured Alice, local agent, verified network and implementation, Alice's available token balance, the agent's native gas balance, and unresolved local payment IDs. Distinguish an unconfigured wallet from a failed RPC check. |
| `doctor` | Check file permissions, readable schemas, key/address consistency, stale lock diagnostics, configuration, network, token metadata, delegation, and contract version. Report fixes without changing delegation, deleting locks, or transacting. |
| `grants link` | Require `--recipient`, `--budget`, and exactly one of `--expires` or `--expires-in`. Default the signer to the local agent; allow explicit `--agent`. Support `--grant-id` for repeatable drafts. Resolve relative expiry once and persist normalized terms so repeated use of the same ID returns the same link without moving its deadline; changed terms are rejected. |
| `grants list` | Default to this agent's grants. Support `--all-agents`, `--status`, `--limit`, and `--cursor`. Use contract enumeration with bounded RPC concurrency and a block snapshot; return a continuation cursor when more scanning is needed. |
| `grants show` | Include signer, recipient, budget, spent, remaining, raw status, derived status, UTC expiry, block number, and whether the signer matches the local agent. Use chain time for expiry. |
| `grants wait` | Poll with a bounded timeout. If a saved draft exists, require its exact signer, recipient, budget, and expiry to match the onchain grant. Alice can edit the form, so an Active status alone does not prove the intended terms. Return immediately for unusable terminal states. |
| `gas check` | Use the grant's signer, `paymentGasReserve`, and `fundingSuggestion`. Show the estimate and suggested separate top-up. Estimation failure means unavailable, never ready. Return the configured approval page with `?grant=ID` for Alice to review funding. |
| `payments prepare` | Require `--grant`, `--recipient`, and `--amount`; optionally accept `--payment-id`. Generate an ID when omitted and save it with normalized terms before returning. This persists an intent without signing or broadcasting. |
| `pay` | Require `--payment-id`. If it identifies a saved intent, load its terms; otherwise require all three payment inputs and persist them first. Explicit terms supplied for an existing ID must match. Default to waiting for one confirmation, matching current payment behavior. |
| `pay --dry-run` | Verify and simulate the exact payment and estimate its gas without signing, broadcasting, reserving a nonce, or writing a new intent. For an unsaved ID, require all payment inputs. Return the block at which checks were made. |
| `pay --no-wait` | Return after RPC acceptance with status `submitted`, the saved payment ID, and transaction hash. Submission is not confirmation. A transport ambiguity returns `unknown` and recovery instructions. |
| `payments list/show` | Describe the local journal, not a complete onchain payment history. Never print private keys or serialized signed transactions. |
| `payments wait` | Look up and validate the saved transaction's receipt. A record with no signed transaction is `not_submitted`; do not turn a status query into a payment. |
| `payments resume` | Load identical saved terms. Check receipts before anything else. Reuse signed bytes if present. If the intent has never been signed, repeat preflight and sign it once. Never automatically change the nonce, fee, amount, recipient, or ID. |

Owner grant creation, legacy approval/rejection, revocation, and gas transfers are exposed through the Alice SDK and consumed by the MetaMask UI. Activation and upgrades retain the existing operator setup path. Omit `grants request`, arbitrary contract calls, key export, automatic key rotation, and automatic funding from the agent CLI.

## Example workflow

For a new Alice account, an operator first follows the existing `wallet:enable` setup. The agent then uses public configuration produced by that setup. Existing users select their current `.agent-wallet` directory so the CLI retains their signer and journals.

```sh
# Existing repo-local state is the default when run from the repository root.
agent-wallet init
agent-wallet whoami
agent-wallet status

# Only needed when attaching an agent installation to operator-provided settings.
agent-wallet config import --file ./wallet-config.json

# Prints and saves the public terms; Alice follows the returned URL.
agent-wallet grants link \
  --recipient "$RECIPIENT" \
  --budget 0.01 \
  --expires-in 24h \
  --json

# GRANT_ID is the full ID returned by grants link.
agent-wallet grants wait "$GRANT_ID" --timeout 300s --json
agent-wallet grants show "$GRANT_ID"
agent-wallet gas check --grant "$GRANT_ID"

# Alice funds the agent separately through the approval UI if needed.
agent-wallet payments prepare \
  --grant "$GRANT_ID" \
  --recipient "$RECIPIENT" \
  --amount 0.006 \
  --json

# PAYMENT_ID is the full ID returned by payments prepare.
agent-wallet pay --payment-id "$PAYMENT_ID" --dry-run --json
agent-wallet pay --payment-id "$PAYMENT_ID" --json

# After interruption, use the same ID instead of preparing another payment.
agent-wallet payments show "$PAYMENT_ID" --json
agent-wallet payments wait "$PAYMENT_ID" --timeout 120s --json
agent-wallet payments resume "$PAYMENT_ID" --json
```

After the first successful `0.006` payment, the `0.01` grant has `0.004` remaining. Another `0.006` payment is rejected; a newly prepared `0.004` payment can consume the remainder. Grants permit spending without reserving Alice's funds, so readiness also depends on her current balance.

Human output should make the two sources of funds clear:

```text
Payment confirmed
  Payment ID        0x...        (full ID in actual output)
  Grant ID          0x...
  Amount            0.006 USDT0
  Payment source    Alice: 0x...
  Gas payer         Agent: 0x...
  Remaining budget  0.004 USDT0   (observed after confirmation)
  Transaction       https://testnet.stablescan.xyz/tx/0x...
```

## Output contract for agents

Every command supports `--json`. Emit exactly one JSON result to stdout, including failures. Send progress to stderr. Add `schemaVersion: 1` and stable symbolic error codes; scripts should never parse human error text.

```json
{
  "schemaVersion": 1,
  "ok": false,
  "command": "pay",
  "error": {
    "code": "PAYMENT_OUTCOME_UNKNOWN",
    "message": "The transaction may have been accepted. Check the saved payment."
  },
  "data": {
    "paymentId": "0x...",
    "transactionHash": "0x...",
    "status": "unknown"
  },
  "recovery": {
    "action": "payments wait",
    "paymentId": "0x..."
  }
}
```

Examples abbreviate IDs; actual results contain full addresses, hashes, and IDs. Serialize token atomic amounts, native atomic amounts, gas values, nonces, timestamps, and block numbers as decimal strings. Include formatted amount strings and explicit decimals: six for payment USDT0, eighteen for native gas USDT0. These are two representations of the same funds on Stable; do not sum native and ERC-20 balances.

Proposed exit codes:

| Exit | Meaning |
| --- | --- |
| `0` | Command completed. Queries can successfully report an unpayable grant; `--no-wait` can successfully report submission. |
| `2` | Invalid syntax or input, including missing payment ID or changed saved terms. |
| `3` | Missing or invalid local setup, key record, configuration, network identity, or delegation. |
| `4` | Preflight rejected the payment, including grant policy, token balance, or gas funding. |
| `5` | RPC unavailable before any potentially submitted transaction. |
| `6` | Waiting timed out or a signed transaction's outcome is pending or unknown. |
| `7` | Included revert, cancellation, different-action replacement, or receipt that fails the expected event check. Use the symbolic code to distinguish them. |
| `8` | Another state-mutating command holds the lock. |

`--timeout` bounds receipt and grant waits. Exceeding it must retain recovery state. `--help` and argument errors must work before state-directory creation or RPC access. Never require an interactive confirmation to execute an explicitly requested payment within an authorized grant.

## Payment execution and recovery

Preserve the existing durable submission order while separating it from console output:

1. Resolve the selected state and validate the immutable intent, IDs, addresses, and exact six-decimal amount. Bind a fresh record to chain, token, Alice, implementation, signer, grant, recipient, and amount.
2. Acquire the mutation lock and save any new intent before RPC submission work. When resuming, check existing receipts before checking whether the grant is still payable. A grant may have expired or become exhausted after the payment succeeded.
3. For an unsigned intent, verify the current network, pinned implementation, delegation, signer, grant terms, unused payment ID, balances, and remaining budget. Simulate the exact `pay` call; the contract remains authoritative at execution time.
4. Prepare and sign once. Persist raw signed bytes, their hash, and transaction context before broadcasting. The current raw transaction already contains the nonce; a new journal version should also expose the decoded nonce as a string for diagnostics.
5. Before broadcasting new or saved bytes, verify that the saved network and delegation pins still match. Broadcast those bytes and record acceptance as submission. A transport failure after signing is recoverable ambiguity, not proof of rejection. Historical receipt observation uses the saved payment context and does not require a currently Active grant.
6. Confirm only after a successful receipt contains the exact `Payment` event from Alice's account for the intended grant, ID, recipient, and amount. Preserve same-action repricing support and reject cancellations or different-action replacements.
7. Persist the verified result before returning it. A failed event check must leave the payment unverified rather than report success from receipt status alone.

Keep signing progress and observed outcome separate in the output model. Existing journals use `created`, `signed`, `submitted`, `confirmed`, `reverted`, and `rejected`. An RPC timeout can leave a `signed` or `submitted` journal whose current outcome is `unknown`; do not migrate that record to a terminal failure.

Read-only status commands never broadcast. `resume` may rebroadcast the exact saved transaction, but a mined revert or confirmed different-action replacement requires an explicit next decision. Version 1 does not implement fee bumping, cancellation, or automatic creation of another attempt.

If a journal is missing and `paymentUsed(ID)` is true, block a new payment with that ID. The boolean proves consumption, not the original amount or recipient. Only a matching event can establish those terms; otherwise report `PAYMENT_ID_CONSUMED_UNVERIFIED`.

The current command lock serializes running processes but does not prevent a later command from starting while an earlier transaction is unresolved. Add a check for unresolved signed transactions before preparing another signed transaction. Saving an unsigned intent does not consume a nonce. Version 1 should serialize writes and block new signing until the previous signer nonce is reconciled. The supported deployment uses one shared state directory for each signer; multiple machines or directories sharing a key need a future coordination design.

## State and configuration

Keep the existing file layout readable:

```text
.agent-wallet/
  agent-key.json                Existing private signer record
  config.json                   Validated public account settings
  payment-0x....json             Existing and new payment journals
  grant-draft-0x....json         New saved approval terms
  command.lock                  Lock for state mutations
  deployment-v3.json            Existing operator records, retained
  activation-v3.json            Existing operator records, retained
```

Resolve state in this order: `--state-dir`, `WALLET_STATE_DIR`, then `.agent-wallet` in the caller's current working directory. Resolve relative CLI paths from that directory, never from the installed package directory. Preserve the old repo-root resolution in legacy script wrappers so their current callers do not silently switch state.

Retain directory privacy, private regular files, rejection of symlink state files, and atomic writes with file and directory syncing. Keys remain plaintext with restricted permissions, as in the current proof of concept. Do not introduce private-key arguments or write secrets to stdout. Read-only chain queries should not instantiate a signer; obtain the selected public agent address from local identity metadata.

Version new journal records and validate old records on load. Before adopting a legacy signed record, validate its saved intent and decode the signed transaction to check its chain, signer, destination, calldata, value, nonce, and hash. Preserve signed bytes and transaction hashes exactly. Do not delete activation journals or reinterpret an uncertain payment as unused.

Configuration import accepts only the allowlisted public schema. Public deployment configuration identifies the hosted demo's Alice and default agent; it does not include that agent's key or grant a new local agent permission. The operator supplies trusted settings, and the CLI verifies their network and code identity. Importing arbitrary configuration is not independent assurance that the implementation is trustworthy.

Initialization in the installed CLI writes local signer state only. Keep browser-public configuration updates in the repo's existing setup adapter; an installed CLI must not write into Vite assets or publish signing state.

## Implementation architecture

Use the existing Node.js 22+ baseline, TypeScript, `viem`, and `node:util.parseArgs`. A small explicit command dispatcher is enough for version 1. Keep the command framework replaceable and spend the design effort on payment semantics.

```text
Agent CLI                         Alice browser app or other UI
    |                                          |
Agent operation services                Lightweight Alice SDK
    |                                          |
Private state and signer               Connected owner wallet
    \                                          /
     \-------- Shared wallet protocol --------/
               ABI, amounts, verification,
               grant reads, gas, receipts
                           |
                 RPC and delegated account
                           |
                         USDT0
```

Source packages and repository adapters:

| Location | Responsibility |
| --- | --- |
| `packages/cli/src/main.ts` | Executable entry, command dispatch, help, flags, exit codes. |
| `packages/cli/src/output.ts` | Human and JSON rendering; no secrets or raw signed bytes. |
| `packages/cli/src/agent/context.ts` | Inject paths, config, public client, clock, and lazy signer access. |
| `packages/cli/src/agent/state.ts` | Secure files, lock, journal schemas, legacy reads, and durable writes. |
| `packages/cli/src/agent/grants.ts` | Approval drafts and URLs, grant enumeration, reads, and waits. |
| `packages/cli/src/agent/payments.ts` | Prepare, preflight, submit, observe, and resume operations. |
| `packages/sdk/src/index.ts` | Public owner SDK factory, types, grant operations, funding, persistence hooks, and confirmation. |
| `packages/sdk/src/protocol.ts` | Browser-safe protocol exports consumed through the SDK package by the CLI and operator scripts. |
| `packages/sdk/src/client/*` | Shared protocol functions: ABIs, amount parsing, verification, grant readers/statuses, gas estimates, receipt checks, and public error types. |
| `packages/contracts/src/*` | Solidity implementation; Foundry tests and fixtures live in the same workspace. |
| `packages/web/src/*` | SDK consumer: wallet discovery, forms, state, storage, and presentation. |
| `scripts/*` | Thin adapters for current npm commands and separate operator tools. |

Extract services from `pay.ts`, `init-agent.ts`, `grant-link.ts`, and the agent-relevant parts of `local.ts`; do not shell out to the scripts. Their top-level execution, process-global paths, console output, and exit-code changes make them unsuitable as an imported API.

Refactor `submit` and transaction observation to return typed data and accept progress callbacks. Preserve `trackTransaction` defaults for the browser while allowing the CLI to set bounded waits. Pin grant list fields and status calculations to the same block. Treat dry-run results and gas reserves as observations, not reservations or guarantees.

Move reusable grant readers and protocol error types into `client/*` so the Alice SDK and agent services can use them without importing one another. Keep CLI exit codes and JSON rendering in the CLI adapter. Build the SDK independently with a small manifest and explicit exports so consuming it does not install the web app's React or the operator toolchain. The runtime SDK API uses typed values; only its persistable operation descriptors require JSON-safe decimal strings.

Build a separate CLI artifact with a dedicated emitting TypeScript configuration. Use ESM with Node-compatible `.js` import specifiers, an executable shebang, and a package `bin` entry. Each package has its own build configuration; the web app uses Vite, and the CLI and SDK use separate TypeScript builds. Test the compiled executable outside the source tree with production dependencies; it must not require `tsx`, Foundry, Vite, Solidity artifacts, or Alice's environment file at runtime.

The repository contains three npm workspaces: `packages/web`, `packages/cli`, and `packages/sdk`. Each owns its source, manifest, build, and tests. The web app and CLI depend on `agent-wallet-sdk` by package name; protocol code is compiled once in the SDK instead of copied into consumers. The private root package orchestrates these builds. The CLI and SDK use allowlists for packed artifacts and can be installed together from local tarballs.

## Delivery phases and acceptance

| Phase | Work | Acceptance condition |
| --- | --- | --- |
| 1 Extract operations | Introduce shared protocol readers/errors, injected context, private state services, typed results, and compatible script adapters. | Existing script, client, and gas tests still exercise the same behavior; legacy keys and journals remain usable. |
| 2 Add Alice SDK and discovery | Extract owner operations into the SDK and migrate the UI. Implement CLI parser/output, identity, configuration, status/doctor, grant drafts/discovery/wait, and gas checks. | The UI performs the same owner actions through the SDK. An agent can obtain the approval URL and determine authorization and funding needs using JSON, without loading Alice's key. |
| 3 Add payment lifecycle | Implement prepare, pay, dry-run, no-wait, local records, receipt observation, recovery, and unresolved-nonce blocking. | The `0.006 / blocked 0.006 / 0.004` workflow works, and an interrupted payment resumes without a second transfer. |
| 4 Package and document | Add separate CLI and SDK builds, a CLI bin, SDK declarations/exports, outside-repo consumer checks, command/API references, and integration examples. | The CLI works from another directory, a minimal browser app can import the SDK, and both complete the workflow through the existing MetaMask approval experience. |

Extend the existing Vitest/Anvil harness to invoke the CLI as a subprocess. Test externally observable behavior:

- JSON is one parseable stdout document on success and failure; progress cannot corrupt it. Help works without configuration or network access.
- Repeated initialization retains the same key. Invalid state, key/address mismatches, symlinks, or unsafe permissions fail without overwriting files.
- Existing journal recovery works after the new CLI is installed. A partial migration never changes signed bytes.
- Draft IDs and terms survive restarts. Grant enumeration handles pagination, multiple agents, legacy statuses, and expiry at the chain timestamp boundary.
- Wrong signer/recipient, inactive/revoked/expired grants, excess precision, insufficient funds, duplicate IDs, and exceeded budgets fail before broadcast where possible.
- Dry-run leaves files, nonces, and balances unchanged. The actual payment still rechecks conditions.
- Simulate a crash after durable signing, a transport error after node acceptance, and a timeout before receipt observation. Resume reuses the saved bytes and proves only one transfer occurred.
- Reject different terms under the same ID, duplicate IDs across grants, success receipts without the expected event, cancellations, and replacements with another action.
- A second writer cannot acquire the lock; a new payment cannot bypass an unresolved signed transaction. Read-only commands remain usable.
- Build and install from an allowlisted package artifact in a temporary directory with production dependencies. Verify it contains no key, journal, local environment, or browser configuration derived from private state.

For the Alice SDK, verify that preparing an operation never submits a transaction; each mutation rejects a wrong owner or wallet chain; forwarded owner calls target the implementation; funding targets the exact grant agent; and receipt checks prove the intended action. Test persistence failures before and after a returned hash, an ambiguous submission with no returned hash, reloading operation descriptors, and waiting without resubmitting. Browser tests should exercise the UI through the SDK, including account changes, rejected signatures, legacy grants, funding timeouts, and unavailable gas estimates. A minimal SDK consumer build must contain no Node filesystem imports, React dependency, operator environment loader, or Solidity build requirement.

Run the existing contract tests and browser tests after refactoring shared modules; run the web build to catch browser compatibility regressions. Keep real testnet acceptance as an explicit developer workflow because it submits transfers and deliberately reverted transactions. Do not run it from `doctor` or a normal CLI test.

## Later extensions

Revisit encrypted or external signers, explicit profiles, onchain payment history, event indexing for large grant sets, configurable confirmation depth, coordinated concurrent payments, and merchant invoice identifiers after the basic interface is proven. External agent runtimes can already call the CLI and consume its JSON; an MCP server or AI integration is a separate layer over the same services.
