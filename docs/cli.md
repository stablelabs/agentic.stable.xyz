# Agent wallet CLI

The CLI runs the local agent signer on Stable Testnet. Alice authorizes grants and funds gas through the browser UI. Payments use Alice's funds and the agent's gas balance.

## Install and run

Use Node.js 22 or newer:

```sh
npm install --global @stablechain/agent-wallet-cli@0.1.1
agent-wallet --help
```

For direct execution, use `npx --yes --package=@stablechain/agent-wallet-cli@0.1.1 agent-wallet --help`. Pin a version in automation. Keep `WALLET_STATE_DIR` on persistent private storage across runs.

For repository development:

```sh
npm ci
npm run build:tools
npm run wallet -- --help
```

For a command available outside this repository, build first and link the separate CLI package:

```sh
npm link --workspace @stablechain/agent-wallet-cli
agent-wallet --help
```

The CLI package depends on `@stablechain/agent-wallet-sdk` and `viem`; it does not need Foundry, React, Vite, or `tsx` at runtime. Package it locally with `npm pack ./packages/cli`. The prepack hook rebuilds it; the SDK must be built first in a repository checkout. Packing does not publish either package.

## Setup and authorization

An operator first enables Alice through the [setup guide](wallet.md#1-set-up-alice-and-the-agent). The CLI never reads Alice's key file.

```sh
agent-wallet init
agent-wallet whoami
# Existing repo users already have config.json. Separate installations import public settings.
agent-wallet config import --file ./wallet-config.json
agent-wallet doctor --json
agent-wallet status

agent-wallet grants link --recipient "$RECIPIENT" --budget 0.01 --expires-in 24h --json
# Alice reviews the returned approval URL and authorizes the grant.
agent-wallet grants wait "$GRANT_ID" --timeout 300s --json
agent-wallet gas check --grant "$GRANT_ID"
```

`grants link` accepts exactly one of `--expires-in 24h` or an explicit UTC `--expires 2030-01-01T00:00:00Z`. Supply `--grant-id` to repeat an existing draft. Its expiry is resolved once and its terms cannot be changed under the same ID. `--agent` can prepare terms for an explicitly selected signer.

`grants list` defaults to the local agent. Use `--all-agents`, `--status active`, `--limit 20`, or the returned `--cursor` to inspect another page. A cursor preserves the block snapshot. `grants show ID` includes cumulative spending and remaining budget. Gas estimates are observations, not reservations; an unavailable estimate is never reported as ready.

## Payments and recovery

```sh
agent-wallet payments prepare --grant "$GRANT_ID" --recipient "$RECIPIENT" --amount 0.006 --json
# Save the returned paymentId as PAYMENT_ID.
agent-wallet pay --payment-id "$PAYMENT_ID" --dry-run --json
agent-wallet pay --payment-id "$PAYMENT_ID" --json

agent-wallet payments list --json
agent-wallet payments show "$PAYMENT_ID" --json
agent-wallet payments wait "$PAYMENT_ID" --timeout 120s --json
agent-wallet payments resume "$PAYMENT_ID" --json
```

`payments prepare` saves an intent without signing. `pay` requires a payment ID and loads saved terms. To submit a fresh explicit ID directly, include `--grant`, `--recipient`, and `--amount`. Reusing an ID with changed terms fails. Amounts have at most six decimals and are never rounded.

`--dry-run` verifies and simulates without writing files or signing. `--no-wait` returns after submission; it does not claim confirmation. `payments show` never broadcasts. `payments wait` observes and saves a verified result. `payments resume` checks existing receipts first, then continues the same intent or rebroadcasts its exact saved bytes. A confirmed or reverted transaction is never automatically signed again.

A timeout means the outcome is unknown. Retain the ID and journal; do not prepare another payment to recover it. The CLI blocks new signing while a previous signed transaction is unresolved. Each signer must use one shared state directory. Successful payment IDs are unique across Alice's entire account.

## State and automation

State resolves from `--state-dir DIR`, then `WALLET_STATE_DIR`, then `.agent-wallet` in the current working directory. Relative paths use the caller's working directory. Existing npm aliases retain their old repository-root resolution. Keep the state directory at mode `700` and private files at mode `600`; the signer file is plaintext. Initialization retains an existing key and refuses unsafe or inconsistent records. `doctor` reports stale locks without removing them.

Every command accepts `--json`. Stdout contains one result with `schemaVersion`, `ok`, `command`, and `data`; failures add a symbolic `error.code` and recovery guidance when applicable. Atomic amounts, nonces, timestamps, and block numbers are decimal strings. Token amounts use six decimals; native gas uses eighteen. Do not sum Alice's token and native views of the same underlying funds.

| Exit | Meaning |
| --- | --- |
| 0 | Command completed; read the returned status to distinguish submission and confirmation. |
| 2 | Invalid arguments or changed intent. |
| 3 | Setup, key, state, account verification, or operation error. |
| 4 | Payment policy or funding rejected before submission. |
| 5 | RPC unavailable before an ambiguous submission. |
| 6 | Pending or unknown payment, unresolved signing, or wait timeout. |
| 7 | Included revert or unverified action receipt. |
| 8 | Another mutation holds the state lock. |

An external agent runtime can prepare an ID, save it with its own task, submit it, and poll `payments wait`. The CLI includes no AI model or merchant delivery logic. Owner operations are available through the [lightweight SDK](sdk.md).
