---
name: agent-wallet-cli
description: "Set up and run the agent-wallet CLI (@stablechain/agent-wallet-cli) to spend an owner's approved USDT0 on Stable Testnet. Use to create an agent signer and approval link, check allowance or gas, send an authorized USDT0 payment, or recover a payment whose outcome is unclear."
---

# Agent Wallet CLI

The owner approves your signer's address on the USDT0 token and sends it native USDT0 for gas. You keep the signer key locally and pay with `transferFrom` from the owner's balance. This works only on Stable Testnet (chain 2201).

## Rules

1. Run every command as `agent-wallet <command> --state-dir "$STATE_DIR" --json`. Read the stdout JSON even when the exit code is nonzero.
2. Each signer has one state directory. Never create a new signer to get past an error.
3. Pay only the recipient and amount the user authorized. A setup or status request never authorizes a payment.
4. A payment is complete only when `data.status` is `"confirmed"`. A transaction hash, `submitted` or `simulated` does not count.
5. To retry or recover a payment, reuse its payment ID. A new ID can pay twice.
6. Never print, copy or edit files in the state directory. It holds a plaintext private key.

## Install and choose the state directory

```sh
npm install --global @stablechain/agent-wallet-cli@0.2.1
agent-wallet --version --json
```

You need Node.js 22+. Don't use 0.1.x, which runs the retired flow. If the global install fails on permissions, use a user-writable npm prefix instead of sudo.

To choose `STATE_DIR`, use the path the user gave. If there is none, use `$WALLET_STATE_DIR`, and if that's unset, use `$HOME/.agent-wallet-erc20`. Make the path absolute and write it into every command. If the CLI falls back to its own default, it uses a directory relative to the current folder. If the user expects an existing signer and you can't find its directory, ask them for it. Don't create a new signer in that case.

## Set up a signer (local only, no network)

Setup is three local commands: `init`, `config import` and `allowance link`. None of them contacts the RPC.

```sh
agent-wallet init --state-dir "$STATE_DIR" --json
```

`data.address` is the signer's address. If a key already exists, `init` keeps it and returns `data.retained: true`.

Next, import the owner's public settings. Use the settings JSON the user or operator gave you, or the file from the approval page's **Download wallet settings** button. If you were given only the owner's address and approval page, write the file yourself:

```json
{"schemaVersion": 2, "chainId": 2201, "rpcUrl": "https://rpc.testnet.stable.xyz",
 "token": "0x78Cf24370174180738C5B8E352B6D14c83a6c9A9", "alice": "OWNER_ADDRESS",
 "approvalUrl": "APPROVAL_PAGE"}
```

```sh
agent-wallet config import --file "$CONFIG_FILE" --state-dir "$STATE_DIR" --json
agent-wallet allowance link --amount "$AMOUNT" --state-dir "$STATE_DIR" --json
```

Return `data.agent` and `data.approvalUrl` from `allowance link`, then stop. Setup doesn't need `doctor` or `status`, which use the network. If you don't have the owner's address, return the signer address and ask for it.

## Check readiness

```sh
agent-wallet status --state-dir "$STATE_DIR" --json
```

The output includes:

- `aliceToken`: the owner's token balance (6 decimals)
- `agentNative`: the signer's gas balance (18 decimals)
- `allowance`
- `unresolvedPayments`

If the allowance is too low, run `allowance link --amount X` and send `data.approvalUrl` to the owner. If gas is too low, run `gas check --recipient R --amount X` and ask the owner to send `data.suggestedTopUp`, which is in 18 decimals.

## Pay

```sh
agent-wallet payments prepare --recipient "$RECIPIENT" --amount "$AMOUNT" --state-dir "$STATE_DIR" --json
agent-wallet pay --payment-id "$PAYMENT_ID" --state-dir "$STATE_DIR" --json
```

- Write amounts as decimal strings with at most 6 decimals. Never round them.
- `prepare` only saves the intent locally. Record `data.paymentId` before you run `pay`, and check that `data.intent.recipient` and `data.amount` match what was authorized.
- Before signing, `pay` checks the owner's balance, the allowance and the gas, then simulates the transfer. If any check fails, it exits with code 4 and signs nothing. Fix the cause and rerun `pay` with the same ID.
- After those checks pass, `pay` broadcasts the transaction and waits up to 120s for confirmation.
- When it finishes, report the payment ID, recipient, amount, `data.status` and `data.explorer`.

To preview a payment without signing it, use `pay --dry-run`.

## Recover

If `pay` exits with code 6 or 7, if the process died, or if you're unsure what happened:

```sh
agent-wallet payments wait "$PAYMENT_ID" --timeout 60s --state-dir "$STATE_DIR" --json
agent-wallet payments resume "$PAYMENT_ID" --state-dir "$STATE_DIR" --json
```

- `wait` is read-only.
- `resume` rebroadcasts the transaction already saved for that ID. If the intent was never signed, `resume` signs it, so run it only while the payment is still authorized.
- `payments list` shows every saved ID.
- If the outcome is still unclear, report the ID and hash and stop.

## Errors

| `error.code` | What to do |
| --- | --- |
| `CONFIG_REQUIRED` | Import the owner's settings (see Set up a signer). |
| `AGENT_REQUIRED` | You probably have the wrong `STATE_DIR`, so find the right one. Run `init` only if you really need a new signer. |
| `INSUFFICIENT_ALLOWANCE` | Send the owner the `allowance link` URL, then rerun the same ID. |
| `INSUFFICIENT_PAYMENT_FUNDS` | The owner needs more USDT0 (https://faucet.stable.xyz). |
| `INSUFFICIENT_GAS` | Ask the owner to send native USDT0 to the signer (see `gas check`), then rerun the same ID. |
| `UNRESOLVED_PAYMENT` | An earlier payment isn't settled yet. Run `payments wait` on the ID in `data.paymentId` first. |
| `PAYMENT_OUTCOME_UNKNOWN` | Follow the Recover section with the same ID. |
| `PAYMENT_REVERTED`, `PAYMENT_UNVERIFIED` | Report the ID and hash. Don't retry automatically. |
| `ACCOUNT_NOT_VERIFIED` | The RPC in the settings isn't Stable Testnet or its USDT0 doesn't match. Report it and stop. Don't switch to a different RPC on your own. |
| `RPC_UNAVAILABLE` | Retry read-only checks a few times. If a policy blocks the RPC, report the host and stop. |
| `STATE_LOCKED` | Another command is still running. Wait for it, and never delete the lock while that process is alive. |
| Anything else | Stop and report it. Don't edit, delete or replace any state. |

The full reference is in `agent-wallet --help --json` and `$(npm root --global)/@stablechain/agent-wallet-cli/docs/`.
