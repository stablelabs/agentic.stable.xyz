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
```

`init` is local. It returns the signer address and keeps any existing key. For an existing signer, set `WALLET_STATE_DIR` to its original absolute directory. Never replace a key to fix missing configuration.

Next, import public settings and generate the owner's approval link. Both steps are local and need no RPC access. Get them from the approval page's **Download wallet settings** button or the operator, or write them using the actual owner address and approval page:

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

```sh
agent-wallet config import --file /absolute/path/wallet-config.json --json
agent-wallet allowance link --amount 0.01 --json
```

Replace `OWNER_ADDRESS` before importing. The hosted approval page must use that same owner. Config import only validates and saves the settings: it doesn't contact the RPC or approve spending. Onchain commands check the network and token before they read or sign. Share the returned approval link with the owner; they approve the agent directly on the token and fund its native gas separately in their wallet. The allowance permits any recipient and has no expiry. The owner can revoke the remainder with `approve(agent, 0)`.

## Pay and recover

```sh
agent-wallet payments prepare --recipient RECIPIENT_ADDRESS --amount 0.001 --json
# Save data.paymentId as PAYMENT_ID, then use that same ID:
agent-wallet pay --payment-id "$PAYMENT_ID" --json
```

Replace `RECIPIENT_ADDRESS` with the authorized recipient. Before signing, `pay` checks the owner's balance, the allowance and the gas, then simulates the transfer. If a check fails, it signs nothing; fix the cause and rerun with the same ID. Otherwise it broadcasts and waits for confirmation. Use `--dry-run` to preview a payment without signing it. Token amounts have six decimals; native gas amounts have eighteen. A simulation or transaction hash is not a confirmed payment. Check `data.status` for `confirmed`.

For uncertain outcomes, retain the ID and state. `payments show ID` and `payments wait ID` do not broadcast; `payments resume ID` can submit or rebroadcast. A new ID can pay twice: IDs are local recovery records, not onchain duplicate protection. Private state contains a plaintext key and signed transactions; keep it out of logs, web assets, and source control.

Read the bundled [CLI reference](docs/cli.md), [operating guide](docs/wallet.md), and [agent skill](skills/agent-wallet-cli/SKILL.md). For Codex discovery, copy the entire skill directory from `$(npm root --global)/@stablechain/agent-wallet-cli/skills/agent-wallet-cli` into `~/.codex/skills/`, then invoke `$agent-wallet-cli` in a new session. Other agents can load its `SKILL.md` directly.

Test-only, unaudited code. No merchant delivery guarantee or production custody service is included.
