# Public settings without a repository checkout

Obtain a verified public configuration file from the operator, or write this schema with the actual wallet owner's address:

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

Replace `OWNER_ADDRESS` with the authorized owner's nonzero Ethereum address before importing. Use the operator's actual approval-page URL; the page's configured owner must match. Local pages may use HTTP on localhost/127.0.0.1. Remote pages and RPCs require HTTPS. An optional `defaultAgent` is only a browser prefill, not the CLI signer selection.

Set `CONFIG_FILE` to the file's absolute path and import it with the same signer directory used for `whoami`:

```sh
agent-wallet config import --file "$CONFIG_FILE" --state-dir "$STATE_DIR" --json
agent-wallet config show --state-dir "$STATE_DIR" --json
```

Config import checks Stable Testnet and USDT0 metadata. It does not authorize a payment, approve allowance, or fund gas. The JSON contains no private keys. Do not put secrets in it or replace the owner's address with a sample to bypass a mismatch.
