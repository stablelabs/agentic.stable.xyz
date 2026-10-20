# Agent spending demo

Approve an agent to spend a limited amount of test USDT0 from your wallet. The agent uses its own key to call the token’s `transferFrom` method and pays its own transaction fees.

The flow is ordinary ERC-20 approval on **Stable Testnet**:

1. The agent generates a local keypair and shares its address.
2. The wallet owner approves that address on the USDT0 token.
3. The owner sends the agent native USDT0 for gas.
4. The agent sends payments from the owner’s token balance, consuming its allowance.

**An allowance limits the amount, not the recipient or time.** The agent can choose any recipient, and permission has no automatic expiry. The owner can revoke the remaining allowance with `approve(agent, 0)`. Approval does not reserve funds; both balance and allowance must be sufficient. Gas funding is separate and is not returned by revoking permission.

## Install the agent CLI

With Node.js 22+, install the standalone CLI:

```sh
npm install --global @stablechain/agent-wallet-cli@0.2.0
agent-wallet --version --json
agent-wallet --help --json
```

The package bundles its runtime, docs, and agent skill; agents do not need to clone this repo or install an SDK. Pin this version: 0.1.x uses the retired contract-grant flow. For an operator-provided tarball produced by `npm run pack:cli`, install it with `npm install --global /absolute/path/stablechain-agent-wallet-cli-0.2.0.tgz`.

Create a signer. This step is local and needs no network access:

```sh
export WALLET_STATE_DIR="$HOME/.agent-wallet-erc20"
agent-wallet init --json
```

`init` returns the signer address. If a key already exists, it keeps that key.

Next, import public settings and generate the owner's approval link. Both steps are local too; the network and token are checked when a balance, allowance, or payment command first runs. Get the settings from the approval page's **Download wallet settings** button or the operator, or write them using the [public configuration schema](docs/wallet.md#public-configuration):

```sh
agent-wallet config import --file /absolute/path/wallet-config.json --json
agent-wallet allowance link --amount 0.01 --json
```

Share `data.approvalUrl` with the owner. They approve the agent and fund its gas on that page. For an existing signer, set `WALLET_STATE_DIR` to its **original absolute state directory**. Installing the package doesn't move keys or journals. If no state directory is set, the CLI uses one relative to the current working directory. The approval page must use the same owner as the settings.

## Run the demo

Use Node.js 22+ and npm. Run every command below from this repository’s root. No package build, Solidity compiler, or account activation is required for the CLI.

```sh
npm ci
export WALLET_STATE_DIR="$PWD/.agent-wallet-erc20"
npm run wallet -- init --json
npm run wallet -- whoami --json
```

Retain this directory and the address printed by `whoami`. Replace the placeholders below with the wallet owner’s address and that agent address:

```sh
npm run wallet:configure -- --owner OWNER_ADDRESS --agent AGENT_ADDRESS
npm run wallet -- config import --file web/public/wallet-config.json --json
npm run dev
```

The configuration contains public addresses only. The owner’s private key stays in MetaMask. Fund your account with test USDT0 from the [Stable faucet](https://faucet.stable.xyz), then open [localhost:5174](http://localhost:5174) with the MetaMask extension or in MetaMask’s mobile browser. Connect your account, approve an allowance, and fund the agent’s gas separately. Any visitor can connect their own account; the web app uses the selected MetaMask address as the owner. Use **Download wallet settings** after connecting to get public CLI settings for that owner, then import the downloaded file into your agent’s existing state directory.

If you run another local port, pass `--approval-url http://127.0.0.1:PORT` to `wallet:configure` before importing the settings. `allowance link --amount 0.01` prints a link with the correct signer and approval amount prefilled.

## Send a payment

```sh
agent-wallet allowance show --json
agent-wallet payments prepare --recipient RECIPIENT_ADDRESS --amount 0.006 --json
```

Copy `data.paymentId` from the preparation result, then:

```sh
PAYMENT_ID="paste data.paymentId here"
agent-wallet pay --payment-id "$PAYMENT_ID" --dry-run --json
agent-wallet pay --payment-id "$PAYMENT_ID" --json
```

Under a `0.01` allowance, `0.006` succeeds, another `0.006` is rejected, and a new `0.004` payment can spend the remainder. Use a recipient different from the owner to demonstrate funds moving; a self-transfer can still consume allowance without changing the owner’s token balance.

For source development, replace `agent-wallet` with `npm --silent run wallet --` from the repository root after `npm ci`. Use the same state directory with either runner.

Payment IDs are local recovery labels. The token does not know them. If submission times out, inspect the same payment with `payments show ID`, observe it with `payments wait ID`, or recover with `payments resume ID`. Never create a new payment to retry an uncertain submission. The CLI saves signed bytes and nonce before broadcast and reuses them during recovery.

The direct flow has been exercised on testnet: [this confirmed agent transaction](https://testnet.stablescan.xyz/tx/0xa9f5eb8c3d29f9ef352b85124dfd12c03844a302a01aeb98ce24d8a1af43e678) called USDT0 `transferFrom` for a `0.001` self-transfer. See [the recorded example and operating notes](docs/wallet.md).

## What stays in the repo

| Directory | Purpose |
| --- | --- |
| [web](web) | MetaMask approval, revocation, gas funding, and payment instructions |
| [agent](agent) | Local signer and payment CLI, including receipt verification and recovery |
| [shared](shared) | Internal token/configuration helpers shared by the browser and CLI |
| [tests](tests) | Signing, allowance, transaction recovery, CLI, and development-server isolation tests |

The CLI is the demo’s runnable agent: it keeps signing outside the browser and handles payment recovery. [packages/cli](packages/cli) packages the same source as a standalone npm executable, including its viem runtime. The root app remains private, the shared layer remains internal, and there is no separately published SDK or custom spending contract. Maintainers can [build, verify, and publish the CLI](docs/cli.md#building-and-publishing).

```sh
npm run check
npm test
npx playwright install chromium
npm run test:browser
npm run build
```

`build` creates `web/dist` with the versioned public deployment settings. The [deployment workflow](.github/workflows/deploy.yml) checks and deploys pushes to `main` to [agentic.stable.xyz](https://agentic.stable.xyz). Cloudflare serves assets and public settings only; no hosted signer or payment API exists.

Read the [CLI reference](docs/cli.md) for commands and errors, and the [operating guide](docs/wallet.md) for state, recovery, migration, and hosting. Existing schema-2 signers and journals remain compatible. If you used the retired contract-grant flow, read the migration notes before spending.

For agent-driven operation, load [the Agent Wallet CLI skill](skills/agent-wallet-cli/SKILL.md). It covers installation, signer discovery, owner approval handoff, payment verification, and recovery without duplicate transfers. The npm package includes it under `$(npm root --global)/@stablechain/agent-wallet-cli/skills/agent-wallet-cli`. Any agent can read `SKILL.md` directly. For Codex discovery, copy that entire skill directory into `~/.codex/skills/`, then invoke `$agent-wallet-cli` in a new session. Refresh the copied skill after upgrading.

Test-only, unaudited code supporting Stable Testnet USDT0. No AI model, merchant delivery guarantee, gas sponsorship, or production custody service is included.
