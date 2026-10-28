# Agent payments demo

Approve `0.01` USDT0. Let your agent pay `0.006`. Dry-run another `0.006` and watch the CLI refuse: only `0.004` remains.

Your wallet key stays in MetaMask. The agent uses its own signer to call `transferFrom` from your wallet. Fund its native USDT0 gas balance separately.

The contract never reads your prompt: this allowance permits any recipient and has no expiry. Revoke the remainder when you’re done; wait for confirmation.

**Demo:** https://agentic.stable.xyz/
**Source and setup:** https://github.com/stablelabs/agentic.stable.xyz
**Faucet:** https://faucet.stable.xyz/

Testnet only; unaudited.
