# Agent CLI

Use Node.js 22+. Install the standalone package:

```sh
npm install --global @stablechain/agent-wallet-cli@0.2.0
agent-wallet --version --json
agent-wallet --help --json
```

This installs the compiled executable and bundled runtime; no checkout, build, SDK, or install scripts are needed. Do not substitute 0.1.x: those releases implement the retired grant flow. For an operator-provided release artifact, install the supplied tarball with `npm install --global /absolute/path/stablechain-agent-wallet-cli-0.2.0.tgz`.

Agents can load the portable skill at `$(npm root --global)/@stablechain/agent-wallet-cli/skills/agent-wallet-cli/SKILL.md` for an operating workflow and recovery decisions. `agent-wallet COMMAND --json` emits one JSON envelope. Preserve stdout even when the process exits nonzero: it contains the structured error and any recovery ID. Source contributors can use `npm --silent run wallet -- COMMAND --json` from the checkout root after `npm ci`.

Use one private persistent state directory per signer. `--state-dir DIR` takes precedence over `WALLET_STATE_DIR`; the default is `.agent-wallet-erc20` relative to the working directory. Keep the same setting in every command and terminal session:

```sh
export WALLET_STATE_DIR="$HOME/.agent-wallet-erc20"
agent-wallet whoami --json
```

The example selects a directory for a new signer. When upgrading from the source runner, point it to the existing directory's absolute path instead. `whoami` prints the address and resolved state directory. Check that this address is the spender approved in MetaMask. Do not initialize another signer to fix missing configuration. Upgrading the package does not migrate, delete, or replace private state.

For first setup, run `agent-wallet init --json`, import operator-provided public settings using `agent-wallet config import --file /absolute/path/wallet-config.json --json`, then run `agent-wallet allowance link --amount 0.01 --json` for the owner's approval link. All three steps are local and need no RPC access. The schema has `schemaVersion: 2`, `chainId: 2201`, `rpcUrl`, `token`, `alice` (actual owner), and `approvalUrl`; see [public configuration](wallet.md#public-configuration). The hosted approval page must use that same owner. The package includes no default owner or private signer.

## Commands

| Command after `agent-wallet` | Purpose |
| --- | --- |
| `init` | Generate a signer, or verify and retain the existing key |
| `whoami` | Show signer address and state directory |
| `config import --file /absolute/path/wallet-config.json` | Validate and import public settings locally, without contacting the RPC |
| `config show` | Show public settings |
| `doctor` | Diagnose signer, journals, network, and stale locks; check `data.ready` |
| `status` | Owner balance, agent gas balance, allowance, and unresolved payments |
| `allowance show` | Read the remaining token allowance to this signer |
| `allowance link --amount 0.01` | Prefill the web approval page for this signer |
| `allowance wait --amount 0.01 --timeout 300s` | Wait until allowance is at least the requested amount |
| `gas check --recipient ADDRESS --amount 0.006` | Estimate this payment’s gas reserve and suggested funding |
| `payments prepare --recipient ADDRESS --amount 0.006` | Save immutable intent and generate a local payment ID |
| `pay --payment-id ID` | Simulate, sign, persist signed bytes, broadcast, and wait |
| `payments list` | List local payment records |
| `payments show ID` | Inspect a record without broadcasting |
| `payments wait ID --timeout 120s` | Observe confirmation without broadcasting |
| `payments resume ID` | Check for a receipt, then reuse the same signed bytes if needed |

Every command accepts `--json`; schema-2 results contain `ok`, `command`, and `data`, plus symbolic errors on failure. Large integers are strings. Check `data.status`: a submitted payment is not yet confirmed. `doctor` may complete successfully with `data.ready: false`.

Preparation accepts an optional nonzero 32-byte `--payment-id`. `pay` accepts `--dry-run`, `--no-wait`, and `--timeout`; dry-run and no-wait cannot be combined. `payments resume` accepts `--no-wait` and `--timeout`. Amounts allow six decimal places and are never rounded.

`config import` and `allowance link` never contact the RPC. Every command that reads or signs onchain (`status`, `doctor`, `allowance show`, `allowance wait`, `gas check`, `pay` and payment recovery) first checks that the RPC is Stable Testnet with the expected USDT0 token.

`allowance wait` observes the current amount only. A low amount may mean the agent already spent it; it does not prove an approval failed. The web app verifies exact approval receipts separately.

## Prepare, simulate, send

After configuring the signer and obtaining owner approval and gas funding:

```sh
agent-wallet payments prepare --recipient RECIPIENT_ADDRESS --amount 0.001 --json
PAYMENT_ID="paste data.paymentId here"
agent-wallet pay --payment-id "$PAYMENT_ID" --dry-run --json
agent-wallet pay --payment-id "$PAYMENT_ID" --json
```

The owner supplies payment tokens; the agent supplies native gas. The owner’s approval permits any recipient and has no automatic expiry. Changing a positive allowance requires a confirmed reset to zero followed by a new approval in the web app.

The CLI’s local payment ID binds one intent to a signed transaction and nonce. It is not an onchain duplicate check. Keep the ID and state across retries. The CLI saves exact signed bytes before broadcast, blocks signing another payment while an earlier one is unresolved, and verifies matching token `Transfer` evidence and transaction terms before confirming.

## Common errors

| Error | Action |
| --- | --- |
| `CONFIG_REQUIRED` | Check `whoami`’s directory, then import operator-provided public JSON using that same directory |
| `ACCOUNT_NOT_VERIFIED` | The settings’ RPC is not Stable Testnet or its USDT0 metadata differs; get corrected settings from the operator |
| `AGENT_REQUIRED` | Initialize the intended state directory; approve its resulting address |
| `INSUFFICIENT_ALLOWANCE` | Have the owner approve this signer; preserve the authorized payment terms |
| `INSUFFICIENT_PAYMENT_FUNDS` | Fund the owner’s token balance |
| `INSUFFICIENT_GAS` | Fund this signer’s native gas balance separately |
| `PAYMENT_OUTCOME_UNKNOWN` | Keep the same ID; use `payments wait` or `payments resume` |
| `UNRESOLVED_PAYMENT` | Reconcile the earlier signed payment before signing another |
| `STATE_LOCKED` | Verify the other command stopped before removing a stale lock |
| `LEGACY_PAYMENT_JOURNAL` | Recover with the matching old tool; see [migration](wallet.md#migration) |

Exit codes: `0` success, `2` invalid input, `3` state/configuration/verification errors, `4` preflight rejection, `5` RPC failure or allowance timeout, `6` unknown outcome, `7` reverted/unverified payment receipt, `8` state lock held. Included reverts may cost gas. A replacement with a different action or missing token event is not payment confirmation.

## Building and publishing

From the repository root:

```sh
npm ci
npm run check
npm test
npm run pack:cli
```

`pack:cli` invokes the package's `prepack` build. `build:cli` bundles `agent/main.ts` and its runtime into `packages/cli/dist/main.js`, includes dependency license notices, and copies the current docs and skill. The package's file allowlist excludes the web app, source tree, local configuration, and private signer state. The package test installs the actual tarball into an isolated prefix and runs the executable from another directory, including a payment against a controlled local RPC fixture.

Install the resulting tarball with `npm install --global /absolute/path/stablechain-agent-wallet-cli-0.2.0.tgz` to use or distribute that artifact directly. An authorized maintainer with publish access to `@stablechain` can publish the verified artifact:

```sh
npm publish ./stablechain-agent-wallet-cli-0.2.0.tgz --access public
```

Publishing is an explicit release step; tests and packing do not publish. Keep the manifest, installation examples, and skill version pin aligned for future releases. Existing 0.1.x installs must retain their old state/tool for grant recovery; they must not replay legacy journals with this executable.
