---
name: agent-wallet-cli
description: "Install and operate @stablechain/agent-wallet-cli for Stable Testnet USDT0 payments. Use for signer setup, public configuration, owner approval links, allowance and gas checks, preparing and submitting transferFrom payments, checking receipts, and recovering uncertain submissions. Also use for CONFIG_REQUIRED, insufficient allowance or gas, unresolved payments, and payment-ID questions. Requires Node.js 22+ and terminal access; no repository checkout, SDK, or hosted signer is needed."
---

# Agent Wallet CLI

Use `agent-wallet` to spend an owner's test USDT0 through an approved agent signer. This skill works with any agent that can read Markdown and run shell commands. Codex metadata in `agents/openai.yaml` is optional for other runtimes.

## Local signer setup — no RPC required

For a setup-only request, install the CLI if needed, create or reuse a signer, and return its public address and the supplied approval link with that address filled in. Stop there. Key creation and address discovery are local operations. Do not require public configuration, RPC access, allowance, gas, or payment readiness to complete signer setup. Do not run `config import`, `doctor`, `status`, or onchain checks for this phase. Read the payment sections and configuration reference only when the task calls for those operations.

Require Node.js 22+. Install the standalone package:

```sh
npm install --global @stablechain/agent-wallet-cli@0.2.0
agent-wallet --version --json
agent-wallet --help --json
```

The package bundles its runtime and needs no build or checkout. For a supplied release artifact, install the operator-provided `stablechain-agent-wallet-cli-0.2.0.tgz` with `npm install --global /absolute/path/to/file.tgz`. If 0.2.0 is unavailable, report that; **do not fall back to 0.1.x**, which implements the retired contract-grant flow. Existing compatible installations can be reused after checking version/help. If global installation lacks filesystem permission, use a user-writable npm prefix and add its `bin` directory to PATH; do not assume sudo is available.

Resolve one **absolute, persistent state directory** for the intended signer. Prefer the user's explicit path, then existing `WALLET_STATE_DIR`, then an identified existing `.agent-wallet-erc20` directory. Resolve relative paths from the working directory that originally used them. When upgrading from the repository runner, keep its original absolute state path. Changing directories or installing the package must not create another identity.

If no identity is identifiable and an existing approved signer is expected, ask for its directory instead of generating a replacement. For a genuinely new signer, choose a persistent location such as `$HOME/.agent-wallet-erc20` when the environment supports persistent storage. Do not promise a chat workspace's files survive across sessions. Set `STATE_DIR` to the selected absolute path; the examples below require it. Always supply `--state-dir "$STATE_DIR"` explicitly. Inspect identity:

```sh
agent-wallet --help --json
agent-wallet whoami --state-dir "$STATE_DIR" --json
```

Once the intended state directory is established, run `init --state-dir "$STATE_DIR" --json`, then `whoami --state-dir "$STATE_DIR" --json` and record its public address. `init` creates a key for a genuinely new signer or verifies and retains an existing key; both paths are local. Do not use a fresh directory or key to fix a configuration or transaction error. Match the returned address to the intended approved spender. `defaultAgent` in public configuration is only a browser prefill; the stored signer determines CLI identity.

Return the public address and construct the approval URL locally using the supplied approval page and allowance. If the prompt supplies a URL template, replace only its agent-address placeholder with the exact `whoami` address. Otherwise use the standard URL API to set `agent` and `amount` query parameters, preserving the supplied page and amount. For example: `https://agentic.stable.xyz/?agent=AGENT_ADDRESS&amount=0.01`, with the actual address and requested amount substituted. This performs no RPC call and needs no imported configuration. Do not write a fabricated `config.json` into the private state directory just to enable `allowance link`.

The owner reviews and approves through MetaMask on that page, where the browser performs its own network checks. An approval link does not imply the agent has checked allowance or can submit payments. If network access is known to be restricted, mention that it will be needed for later onchain operations while still completing local signer setup. A setup-only request does not authorize a payment.

## Configure for onchain operations

When the user requests balance/allowance checks or an authorized payment, import operator-provided **public** settings if missing:

```sh
agent-wallet config import --file "$CONFIG_FILE" --state-dir "$STATE_DIR" --json
```

Set `CONFIG_FILE` to an operator-provided public JSON file. Check the owner (`alice` is its legacy field name), token, network, and approval URL against the user's intended setup. If settings do not exist, create the public schema described in [configuration reference](references/configuration.md) using the actual owner and approval page. Do not silently use a sample or deployment owner. Config import verifies chain/token and does not grant spending permission.

These operations need RPC access. If import fails because the environment blocks the configured RPC, report the hostname and stop the onchain operation. Preserve the existing signer and state. Do not change RPCs to work around an access policy or create another signer. Network restrictions do not invalidate the local signer setup or prevent constructing its approval link.

After configuration, inspect diagnostics and balances as needed for the requested onchain task:

```sh
agent-wallet doctor --state-dir "$STATE_DIR" --json
agent-wallet status --state-dir "$STATE_DIR" --json
```

`doctor` verifies the key, journals, and network; it is not a local setup prerequisite. `allowance link` constructs a URL locally from imported settings. The setup-only URL construction above works before import and does not require skipping any transaction verification.

This CLI supports **Stable Testnet, chain 2201**, and USDT0 at `0x78Cf24370174180738C5B8E352B6D14c83a6c9A9`. Token amounts have **6 decimals**; native gas amounts have **18 decimals**. Never round a payment to make it fit. Use decimal strings and integer arithmetic for atomic amounts, not floating point.

## Interpret command results

- Use `agent-wallet … --json` so stdout is one JSON envelope. Keep stderr separate. For source development only, `npm --silent run wallet -- … --json` is equivalent when run from the checkout root.
- Parse stdout even on nonzero process exit. Preserve `error.code`, `error.message`, `data.paymentId`, any transaction hash, and `recovery`. The envelope is `{schemaVersion: 2, ok, command, data, error?, recovery?}`; large integers are decimal strings.
- `ok: true` means the command completed, not that funds moved. Check `doctor.data.ready`, `status.data.configured`, and both `gas check`'s `data.available` and `data.ready`. `available: false` can mean simulation failed; it is not proof of insufficient gas.
- Claim payment completion only with `data.status: "confirmed"` from payment receipt verification. `created`, `simulated`, `signed`, `submitted`, `unknown`, and a transaction hash alone are not confirmation.
- Current runtime `--help` and the package's bundled `docs/cli.md` and `docs/wallet.md` are authoritative if the CLI has changed. A default global install places them under `$(npm root --global)/@stablechain/agent-wallet-cli/`. Do not invent commands, grant IDs, expiry flags, SDK methods, or retired contract flows.

## Obtain allowance and gas

The owner approves the **agent address directly on the token**, then separately sends native USDT0 to that address for gas. Tokens for the payment remain with the owner. Allowance permits any recipient and has no expiry; it does not reserve funds. Revocation sets allowance to zero and does not reclaim agent gas.

```sh
agent-wallet allowance show --state-dir "$STATE_DIR" --json
agent-wallet allowance link --amount "$BUDGET" --state-dir "$STATE_DIR" --json
```

Set `BUDGET` to the requested allowance in human token units. Give the owner the returned `data.approvalUrl` and agent address to approve/fund in their wallet. Never request their private key. Changing a positive allowance in the web app requires a confirmed reset to zero before the new approval.

After the owner's action, check allowance again. Optional `allowance wait --amount "$BUDGET" --timeout 45s` observes current allowance; a timeout may mean funds were already spent, not a failed approval. Use bounded waits and report ongoing state rather than polling indefinitely.

Allowance is a technical capability, not permission to choose a payment. Use the user's authorized recipient and amount. Ask only for missing payment terms or necessary authorization; do not add a confirmation when the user already authorized that transfer. A setup/status request does not authorize a payment. Do not substitute the owner as recipient: a self-transfer can consume allowance without moving net funds.

## Prepare, simulate, submit, confirm

Set `RECIPIENT` and `AMOUNT` from the authorized task. Amounts are positive decimal USDT0 strings with at most six fractional digits. Inspect `status` and reconcile any earlier signed unresolved payment before creating a new intent.

```sh
agent-wallet gas check --recipient "$RECIPIENT" --amount "$AMOUNT" --state-dir "$STATE_DIR" --json
agent-wallet payments prepare --recipient "$RECIPIENT" --amount "$AMOUNT" --state-dir "$STATE_DIR" --json
```

Record `data.paymentId` from preparation as `PAYMENT_ID`. Persist this ID with the task before submission. Check `data.intent.alice`, `agent`, `recipient`, and `amount` (atomic units), plus `data.amount` (human units), against the intended payment. Preparation is local; it does not prove balance, allowance, or gas readiness.

```sh
agent-wallet pay --payment-id "$PAYMENT_ID" --dry-run --state-dir "$STATE_DIR" --json
agent-wallet pay --payment-id "$PAYMENT_ID" --no-wait --state-dir "$STATE_DIR" --json
agent-wallet payments wait "$PAYMENT_ID" --timeout 45s --state-dir "$STATE_DIR" --json
```

Proceed to submission only after simulation succeeds and the terms remain authorized. Dry-run neither signs nor broadcasts. `--no-wait` submits and returns before confirmation; preserve its hash and observe the same ID. The CLI verifies exact transaction terms and matching token `Transfer` evidence before confirming. Report payment ID, recipient, amount, confirmed/pending state, and returned explorer link. Never describe simulation as a real payment or payment confirmation as merchant delivery.

## Recover without duplicate payment

The payment ID is a **local journal label**, not an onchain deduplication key. A fresh ID can pay twice. The CLI saves signed bytes, hash, and nonce before broadcast and reuses them on recovery. Keep the original signer directory and payment ID even when a process crashes or RPC times out.

```sh
agent-wallet payments list --state-dir "$STATE_DIR" --json
agent-wallet payments show "$PAYMENT_ID" --state-dir "$STATE_DIR" --json
agent-wallet payments wait "$PAYMENT_ID" --timeout 45s --state-dir "$STATE_DIR" --json
```

`show` is local and `wait` never broadcasts. If submission/rebroadcast is still authorized and needed, use:

```sh
agent-wallet payments resume "$PAYMENT_ID" --no-wait --state-dir "$STATE_DIR" --json
```

Resume checks existing receipts and reuses saved signed bytes. **An unsigned saved intent can be signed and submitted by resume**; it is not a read-only check. Observe again with `payments wait`. If the outcome remains unclear, report the original ID/hash and blocker; do not automatically create a replacement intent. See [recovery reference](references/recovery.md) for errors and terminal outcomes.

The state directory contains a plaintext private key and signed transaction journals. Keep it private (directory mode 700, files 600). Use CLI views instead of dumping files; never include keys or raw signed transactions in chat, logs, commits, or web assets. Do not delete or edit journals, regenerate keys, copy a signer into concurrently used directories, remove an unverified lock, or bypass receipt verification to make a command succeed.
