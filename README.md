# Agent spending on Stable Testnet

Give an agent a spending limit without handing it your wallet’s private key. Approve a small amount of test USDT0, then ask your agent to pay from that allowance using its own local signer.

**[Try the demo](https://agentic.stable.xyz) · [Agent skill](skills/agent-wallet-cli/SKILL.md) · [CLI and recovery guide](docs/cli.md)**

![The five-step agent spending demo in a grayscale interface](docs/images/demo.png)

## Before you begin

- Use the MetaMask browser extension or MetaMask’s mobile browser.
- Get free test USDT0 for your wallet from the [Stable faucet](https://faucet.stable.xyz).
- Use an agent with terminal access, **Node.js 22+**, and persistent private storage. The website guides the handoff; it does not host an AI model or agent signer.

This demo supports **USDT0 on Stable Testnet, chain 2201**. Use test funds only.

## Try the demo in five steps

1. **Connect your wallet.** Open the [demo](https://agentic.stable.xyz) and connect MetaMask. The app switches to Stable Testnet. Connecting shares your public address; it does not approve spending.
2. **Set up your agent.** Choose a small allowance such as `0.01` USDT0, copy the setup prompt, and paste it into an agent chat. Your agent creates or reuses a local signer and returns an approval link. Open that link in the same browser. If you already have a signer, enter its separate address instead.
3. **Approve an allowance.** Review the agent address and limit, then confirm in MetaMask. Your tokens remain in your wallet until the agent spends them.
4. **Fund transaction fees.** Send a small gas top-up to the agent from the page. This is a separate transfer of native USDT0. The agent checks the exact fees before making a payment.
5. **Make a payment.** Enter a recipient and amount, then copy the payment prompt into the **same agent chat**. Wait for the agent to report `confirmed`, a payment ID, and an explorer link. Verify the recipient and amount on the explorer and check the remaining allowance on the page. Revoke the allowance in step 3 when you finish.

The current step expands automatically; **Show all steps** exposes the complete form. Completed steps remain available for review. Copying a prompt does not send money. Pasting the payment prompt asks your agent to send exactly that payment.

**What the allowance permits:** the agent can send up to its remaining allowance **to any recipient, with no automatic expiry**. Revoking stops future spending after confirmation; it cannot undo confirmed payments. Approval does not reserve funds. Fee funding belongs to the agent and is not returned by revoking its allowance. To replace a positive allowance, revoke to zero, wait for confirmation, then approve the new limit.

## What success looks like

A useful acceptance walkthrough is: approve `0.01`, fund fees, pay `0.006` to a **different wallet**, verify `0.004` remains, and dry-run another `0.006` to see it rejected before signing. Revoke the remainder and confirm that further spending fails. Preserve each payment ID; never create another ID to retry an uncertain transfer.

The repo records [a confirmed historical testnet transaction](https://testnet.stablescan.xyz/tx/0xa9f5eb8c3d29f9ef352b85124dfd12c03844a302a01aeb98ce24d8a1af43e678) for a `0.001` self-transfer. That proves authorization and allowance consumption for that transaction; it does not demonstrate delivery to a different wallet or validate a new release. See the [operating guide](docs/wallet.md#verified-testnet-example) for the recorded receipt.

## Install or operate the CLI directly

Release **0.2.1** aligns local-only setup with the website and skill. It requires no checkout, build, SDK, or install script:

```sh
npm install --global @stablechain/agent-wallet-cli@0.2.1
agent-wallet --version --json
export WALLET_STATE_DIR="$HOME/.agent-wallet-erc20"
agent-wallet init --json
agent-wallet config import --file /absolute/path/wallet-config.json --json
agent-wallet allowance link --amount 0.01 --json
```

Use the public settings from **Download wallet settings** in step 2, or create them using the [configuration schema](docs/wallet.md#public-configuration). All three setup commands are local. Balance and payment commands verify the network before reading or signing.

For an existing signer, set `WALLET_STATE_DIR` to its **original absolute directory**. Installation does not move keys or journals. Never create a replacement signer to get past an error. Without an explicit directory the CLI default is relative to the working directory.

After approval and fee funding:

```sh
agent-wallet payments prepare --recipient RECIPIENT_ADDRESS --amount 0.006 --json
PAYMENT_ID="paste data.paymentId here"
agent-wallet pay --payment-id "$PAYMENT_ID" --json
```

Replace the recipient with the intended wallet. `pay` checks balance, allowance and gas, simulates, signs, broadcasts and waits for confirmation. Use `--dry-run` to preview without signing. If submission is uncertain, inspect or recover **that same ID** with `payments show`, `payments wait` or `payments resume`; a new ID can pay twice. See the [CLI reference](docs/cli.md).

Do not substitute 0.1.x, which uses the retired contract-grant flow. Retain old signer state and the matching historical tool for legacy recovery; read the [migration notes](docs/wallet.md#migration).

<a id="run-the-demo"></a>

## Develop locally

Run these commands from a clean checkout with Node.js 22.12+ and npm:

```sh
npm ci
export WALLET_STATE_DIR="$PWD/.agent-wallet-erc20"
npm run wallet -- init --json
```

Keep the returned agent address and state directory. Replace `OWNER_ADDRESS` with your MetaMask account and `AGENT_ADDRESS` with that signer:

```sh
npm run wallet:configure -- --owner OWNER_ADDRESS --agent AGENT_ADDRESS
npm run wallet -- config import --file web/public/wallet-config.json --json
npm run dev
```

Open [localhost:5174](http://localhost:5174) in a browser with MetaMask. For another port, pass `--approval-url http://127.0.0.1:PORT` to `wallet:configure` before importing the settings. For source CLI development, replace `agent-wallet` with `npm --silent run wallet --` and keep the same state directory.

The frontend uses [shadcn/ui](https://ui.shadcn.com), Radix primitives and a neutral grayscale theme. Libre Baskerville headings and Atkinson Hyperlegible body text are self-hosted from Fontsource. UI primitives live in `web/src/components/ui`; tokens and responsive layout live in `web/src/style.css`.

## Check, release and freeze

```sh
npm run check
npm test
npx playwright install chromium
npm run test:browser
npm run build
npm run pack:cli
```

Checks cover release-version alignment, type safety, the packaged executable, local-only setup, allowance limits, receipt verification, transaction recovery, wallet/account changes, the guided journey, and development-server isolation. Automated blockchain interactions use fixtures; a fresh live acceptance walkthrough remains a separate release gate.

The [release checklist](docs/release.md) describes publishing the exact tested tarball, tagging the frozen skill, deployment and live acceptance. Public installation instructions assume the matching release is available. Before deploying, `npm run verify:published-cli` compares the registry artifact and tagged skill with this checkout. Deployment stops if either is missing or different.

[CI](.github/workflows/deploy.yml) checks pull requests. Pushes to `main` also verify the published release, deploy to Cloudflare, and smoke-test the public site. Builds use only the versioned public deployment settings. Cloudflare serves assets and public configuration; no signer or payment API is hosted.

| Directory | Purpose |
| --- | --- |
| [web](web) | Five-step wallet-owner experience and public deployment |
| [agent](agent) | Local signer, payment verification and recovery |
| [shared](shared) | Token and configuration helpers |
| [packages/cli](packages/cli) | Standalone executable with bundled runtime, docs and skill |
| [tests](tests) | CLI, payment, state, packaging and server-isolation checks |

For agent-driven operation, read [the skill](skills/agent-wallet-cli/SKILL.md). It also ships inside the npm package under `$(npm root --global)/@stablechain/agent-wallet-cli/skills/agent-wallet-cli`. Agents can read it directly. Codex users can copy that entire directory into `~/.codex/skills/` and invoke `$agent-wallet-cli` in a new session; refresh the copy after upgrading.

Test-only, unaudited code. The signer key is stored locally in plaintext with restricted file permissions. No production custody, recipient policy, expiry, gas sponsorship, or merchant-delivery guarantee is included. The shared layer is internal; there is no separately published SDK or custom spending contract.
