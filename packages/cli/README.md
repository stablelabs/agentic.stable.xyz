# Agent Wallet CLI

Standalone agent signer and ERC-20 `transferFrom` payments for USDT0 on Stable Testnet (chain 2201). Node.js 22+ is required. The npm package includes the compiled runtime, its dependencies, operating docs, and an agent skill. No repository checkout, TypeScript loader, SDK, or install-time build is needed.

## Install

Install the published release:

```sh
npm install --global @stablechain/agent-wallet-cli@0.2.0
agent-wallet --version --json
agent-wallet --help --json
```

Pin 0.2.0 or a later compatible version. Versions 0.1.x use the retired contract-grant flow.

For a provided release tarball, install it directly with `npm install --global /absolute/path/stablechain-agent-wallet-cli-0.2.0.tgz`. Maintainers can create this artifact with `npm run pack:cli` from the repository root.

## Configure a signer

Keep one persistent, private directory per signer. Reuse the original directory when upgrading or recovering; changing working directories must not select another signer.

```sh
export WALLET_STATE_DIR="$HOME/.agent-wallet-erc20"
agent-wallet init --json
agent-wallet whoami --json
agent-wallet config import --file /absolute/path/wallet-config.json --json
agent-wallet doctor --json
agent-wallet allowance link --amount 0.01 --json
```

For an existing signer, set `WALLET_STATE_DIR` to its existing absolute directory instead. Never replace a key to fix missing configuration.

Obtain public configuration from the operator, or create a JSON file using the actual owner address and approval page:

```json
{
  "schemaVersion": 2,
  "chainId": 2201,
  "rpcUrl": "https://rpc.testnet.stable.xyz",
  "token": "0x78Cf24370174180738C5B8E352B6D14c83a6c9A9",
  "alice": "OWNER_ADDRESS",
  "approvalUrl": "https://agentic.stable.xyz"
}
```

Replace `OWNER_ADDRESS` before importing. The hosted approval page must use that same owner. Config import verifies network/token but does not approve spending. Share the returned approval link with the owner; they approve the agent directly on the token and fund its native gas separately in their wallet. The allowance permits any recipient and has no expiry. The owner can revoke the remainder with `approve(agent, 0)`.

## Pay and recover

```sh
agent-wallet payments prepare --recipient RECIPIENT_ADDRESS --amount 0.001 --json
# Save data.paymentId as PAYMENT_ID, then use that same ID:
agent-wallet pay --payment-id "$PAYMENT_ID" --dry-run --json
agent-wallet pay --payment-id "$PAYMENT_ID" --no-wait --json
agent-wallet payments wait "$PAYMENT_ID" --timeout 45s --json
```

Replace `RECIPIENT_ADDRESS` with the authorized recipient. Token amounts have six decimals; native gas amounts have eighteen. A simulation or transaction hash is not a confirmed payment. Check `data.status` for `confirmed`.

For uncertain outcomes, retain the ID and state. `payments show ID` and `payments wait ID` do not broadcast; `payments resume ID` can submit or rebroadcast. A new ID can pay twice: IDs are local recovery records, not onchain duplicate protection. Private state contains a plaintext key and signed transactions; keep it out of logs, web assets, and source control.

Read the bundled [CLI reference](docs/cli.md), [operating guide](docs/wallet.md), and [agent skill](skills/agent-wallet-cli/SKILL.md). For Codex discovery, copy the entire skill directory from `$(npm root --global)/@stablechain/agent-wallet-cli/skills/agent-wallet-cli` into `~/.codex/skills/`, then invoke `$agent-wallet-cli` in a new session. Other agents can load its `SKILL.md` directly.

Test-only, unaudited code. No merchant delivery guarantee or production custody service is included.
