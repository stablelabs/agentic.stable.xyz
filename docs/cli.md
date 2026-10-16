# Agent wallet CLI

`@stablechain/agent-wallet-cli` provides the `agent-wallet` executable for a local agent signer on Stable Testnet. Alice authorizes grants and funds gas through the browser UI. Payments use Alice's funds and the agent's gas balance. An external agent runtime can invoke the CLI and consume its JSON; no AI model is included.

## Install and run

Use Node.js 22 or newer:

```sh
npm install --global @stablechain/agent-wallet-cli@0.1.2
agent-wallet --help
```

Or execute a pinned version without a global install:

```sh
npx --yes --package=@stablechain/agent-wallet-cli@0.1.2 agent-wallet --help
```

The installed CLI depends on the SDK and `viem`. It does not require Foundry, React, Vite, `tsx`, Alice's key file, or a checkout of this repository.

For repository development, run from the root:

```sh
npm ci
npm run build:tools
npm run wallet -- --help
npm --silent run wallet -- status --json
```

Use `npm --silent run wallet` when a caller needs JSON without npm's script banners. To expose the development executable outside the checkout, build first, then run `npm link --workspace @stablechain/agent-wallet-cli`. Relative state paths still resolve from the caller's working directory.

## Setup and authorization

An operator first enables Alice through the [setup guide](wallet.md#1-set-up-alice-and-the-agent), then supplies the generated [public wallet configuration](wallet.md#public-wallet-configuration). A standalone CLI imports that file; it never reads Alice's key. Repository users can select their existing `.agent-wallet` directory to retain configuration, identity, and payment journals.

```sh
export WALLET_STATE_DIR="$HOME/.local/share/stable-agent-wallet"
agent-wallet init --json
agent-wallet whoami --json
agent-wallet config import --file ./wallet-config.json --json
agent-wallet doctor --json
agent-wallet status --json

agent-wallet grants link --recipient "$RECIPIENT" --budget 0.01 --expires-in 24h --json
# Save data.grantId as GRANT_ID. Alice reviews data.approvalUrl and authorizes it.
agent-wallet grants wait "$GRANT_ID" --timeout 300s --json
agent-wallet gas check --grant "$GRANT_ID" --json
```

Set `RECIPIENT` to the intended full address. Keep the same state directory across invocations, container restarts, and payment recovery. `init` retains an existing key. Configuration import verifies the chain, token metadata, implementation bytecode, delegation, and wallet version; it does not authorize spending. The configuration's `defaultAgent` is a UI hint, not the identity of a new local signer.

`grants link` accepts exactly one of `--expires-in 24h` or an explicit UTC `--expires 2030-01-01T00:00:00Z`. Supply `--grant-id` to repeat an existing draft. Relative expiry is resolved once; neither its deadline nor other terms can change under the same ID. `--agent` can prepare terms for another signer, but `grants wait` requires the resulting grant to belong to this local agent. It also checks saved draft terms against the onchain grant.

Alice can edit the approval form before signing. If she authorizes different terms, `grants wait` reports `GRANT_TERMS_MISMATCH`; an Active grant alone does not prove approval of the saved draft. Alice funds agent gas as a separate transfer after grant creation. Gas estimates are observations, not reservations; an unavailable estimate is never reported as ready.

## Command reference

Every command accepts `--json`, `--state-dir DIR`, `--help`, and `--version`.

| Command | Inputs and behavior |
| --- | --- |
| `init` | Create a local signer or verify and retain its existing key/address record. No account configuration or RPC is needed. |
| `whoami` | Show the local public address and resolved state directory. |
| `config import --file FILE` | Validate and verify operator-provided public JSON, then save its allowlisted fields. Existing payment records prevent switching account, implementation pins, or RPC. |
| `config show` | Show the selected public settings. |
| `status` | Show setup, balances, and local payments; a configured account is verified over RPC. |
| `doctor` | Check the key, payment records, account setup, and lock. Read `data.ready` and each entry in `data.checks`; failed checks do not make this diagnostic command exit nonzero. |
| `grants link` | Save an approval draft. Requires `--recipient`, `--budget`, and one expiry option; accepts `--agent` and `--grant-id`. Signs and submits nothing. |
| `grants list` | List this agent's grants, newest first. Accepts `--all-agents`, `--status`, `--limit` (1–100, default 20), and `--cursor`. |
| `grants show ID` | Show terms, derived status, remaining budget, observation block/time, and local signer match. |
| `grants wait ID` | Wait for an Active grant with the saved terms and local signer; default timeout 300 seconds. |
| `gas check --grant ID` | Show the grant agent's native balance, estimated reserve, suggested top-up, and approval URL. |
| `payments prepare` | Save an unsigned intent using `--grant`, `--recipient`, and `--amount`; optionally accept `--payment-id`. Authorization and funds are checked later by `pay`. |
| `pay --payment-id ID` | Load a saved intent, or require all three payment terms for a fresh explicit ID. Accepts `--dry-run`, `--no-wait`, and `--timeout`. |
| `payments list` / `payments show ID` | Inspect local journals without broadcasting; these are not a complete onchain history. |
| `payments wait ID` | Observe and save a verified receipt without broadcasting. An unsigned intent returns `not_submitted`. |
| `payments resume ID` | Continue the same saved intent, checking receipts first and reusing signed bytes when present. Accepts `--no-wait` and `--timeout`. |

`grants list --status` accepts `unknown`, `pending`, `active`, `rejected`, `revoked`, `expired`, and `exhausted`. A continuation cursor preserves the listing's block snapshot; keep the filters unchanged when continuing a page. A bounded scan can return no matching items while still returning a cursor. Expiry uses chain time.

Timeouts and relative expiry use positive durations with `ms`, `s`, `m`, `h`, or `d`, such as `120s` or `24h`. Payment receipt waits default to 120 seconds and one confirmation. `--dry-run` and `--no-wait` cannot be combined.

## Payments and recovery

```sh
agent-wallet payments prepare --grant "$GRANT_ID" --recipient "$RECIPIENT" --amount 0.006 --json
# Save data.paymentId as PAYMENT_ID before submitting.
agent-wallet pay --payment-id "$PAYMENT_ID" --dry-run --json
agent-wallet pay --payment-id "$PAYMENT_ID" --json

agent-wallet payments show "$PAYMENT_ID" --json
agent-wallet payments wait "$PAYMENT_ID" --timeout 120s --json
agent-wallet payments resume "$PAYMENT_ID" --json
```

Reusing an ID with changed terms fails. Amounts must be positive decimal strings with at most six fractional digits; extra precision is rejected without rounding. After a successful `0.006` payment from a `0.01` grant, another `0.006` fails. Prepare a new `0.004` payment to spend the remainder.

`--dry-run` verifies and simulates without writing files, signing, or broadcasting. `--no-wait` returns after submission and does not claim confirmation. A timeout or transport ambiguity means the outcome is unknown: retain the ID and journal, inspect the receipt, and wait or resume that same intent. Do not prepare another payment to recover it.

Before broadcast, the journal saves the exact signed bytes, hash, nonce, and immutable intent. `payments resume` checks receipts first, then continues an unsigned intent or rebroadcasts those exact bytes. Confirmation requires the matching `Payment` event. A confirmed or reverted transaction is never automatically signed again, and a cancellation or different-action replacement is not payment confirmation. Same-action repricing can be observed by its confirmed hash; the CLI offers no fee-bump or cancellation command.

New signing is blocked while another signed transaction for this signer remains unresolved. Use one shared state directory for each signer; independent copies of its key do not coordinate nonces. Successful payment IDs are unique across Alice's entire account. A consumed ID without a matching journal/receipt blocks a new payment rather than proving its original terms.

## State and automation

State resolves from `--state-dir DIR`, then `WALLET_STATE_DIR`, then `.agent-wallet` in the current working directory. Relative paths use the caller's working directory. The compatibility `wallet:*` scripts retain repository-root resolution and their older human output/exit behavior; use the CLI for structured automation.

The state directory must have mode `700` and its files mode `600`. It contains a plaintext signer key, public configuration, saved grant drafts, and private payment journals with signed transactions. The CLI refuses unsafe permissions, symlinks, inconsistent records, and concurrent mutations. `doctor` reports existing locks without removing them; verify that the recorded process has stopped before removing a stale lock. Retain keys and journals when diagnosing an error.

With `--json`, stdout contains one result with `schemaVersion: 1`, `ok`, `command`, and `data`. Failures add `error.code` and `error.message`; pending/unknown errors may include recovery guidance. For example, `agent-wallet pay --json` without an ID returns exit 2:

```json
{
  "schemaVersion": 1,
  "ok": false,
  "command": "pay",
  "error": {
    "code": "PAYMENT_ID_REQUIRED",
    "message": "Use --payment-id, or save a new ID with payments prepare first."
  },
  "data": null
}
```

Atomic amounts, nonces, timestamps, and block numbers are decimal strings. Token amounts use six decimals; native gas uses eighteen. Do not sum Alice's token and native views of the same underlying funds. Check the returned status even when `ok` is true: `submitted`, `simulated`, and `not_submitted` are not confirmations, and diagnostic readiness is a separate field.

| Exit | Meaning |
| --- | --- |
| 0 | Command completed; inspect its data for readiness or payment outcome. |
| 2 | Invalid arguments or changed intent. |
| 3 | Setup, key, state, account verification, or operation error. |
| 4 | Payment/grant policy or funding rejected before submission. |
| 5 | RPC unavailable before an ambiguous submission. |
| 6 | Pending or unknown payment, unresolved signing, or wait timeout. |
| 7 | Included revert or an action receipt that cannot be verified. |
| 8 | Another mutation holds the state lock. |

Owner operations use the [SDK](sdk.md). For package builds, publication, and partial-release recovery, see the [release guide](releases.md).
