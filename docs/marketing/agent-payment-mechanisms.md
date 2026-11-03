# Where is spending authority enforced?

[Editable Excalidraw](agent-payment-mechanisms.excalidraw) · [PNG preview](agent-payment-mechanisms.png)

Open the `.excalidraw` file in Excalidraw. Each mechanism has its own frame. Select a frame title and press **Shift+2** to fit it; **Shift+1** fits the whole sketch. Use the first frame alongside the live demo; pan down for the historical comparison. Blue arrows are calls; green arrows are token movement. Dashed green arrows show optional gas funding by the owner.

## Presentation beats

1. **Permission.** The owner calls `approve(agent, 0.01)`. Funds stay with the owner. The token records how much this spender may draw.
2. **Payment.** The agent signs `transferFrom(owner, recipient, 0.006)`. The token moves funds directly to the recipient. Remaining allowance: `0.004`. The agent pays gas from its own account.
3. **Boundary.** An allowance permits any recipient and has no expiry. A prompt can name one payment; it cannot narrow the token’s permission. `approve(agent, 0)` removes that allowance once confirmed.
4. **Earlier policy layer.** Deploy `AgentWallet` implementation code, then delegate the owner’s existing address through EIP-7702. Create a grant containing the agent signer, recipient, budget and expiry. The agent calls `pay(...)` at the owner account; its code checks the grant and payment ID, then calls the token’s `transfer(...)`.

The earlier design did **not** deploy a new funded wallet address or make the agent a co-owner. The implementation supplies code; EIP-7702 enables it at the owner’s existing address. `revokeGrant(id)` disables that grant after confirmation and leaves the delegation in place.

## Details to keep precise

- Diagram amounts use USDT0 display units. ERC-20 calldata uses six decimals: `0.01 = 10_000`, `0.006 = 6_000`.
- Native and ERC-20 USDT0 expose the same underlying balance per account. The owner’s payment balance and the agent’s gas balance belong to different accounts.
- Current payment IDs are local recovery records. Historical IDs were checked onchain across the owner account. That rejects reuse of an ID; a new ID can still describe another payment.
- Neither mechanism reserves funds. Revocation affects the relevant permission after confirmation; it does not reverse payments or recover the agent’s gas balance.
- The historical flow is source material, not a second live demo. The owner’s grant call goes through `createGrantFor(...)` on the implementation, which forwards to the delegated owner account.

## Source

- Current: [owner approval](https://github.com/stablelabs/agentic.stable.xyz/blob/f8c381aa5b6345ac2bce43c455e80fd4dbc89b85/shared/owner.ts), [agent payment](https://github.com/stablelabs/agentic.stable.xyz/blob/f8c381aa5b6345ac2bce43c455e80fd4dbc89b85/agent/payments.ts).
- Historical `v0.1.2`, commit `21ca30d`: [AgentWallet contract](https://github.com/stablelabs/agentic.stable.xyz/blob/21ca30d540ba2f14c56b41e2b1aaa57348312c01/packages/contracts/src/AgentWallet.sol), [deployment and EIP-7702 activation](https://github.com/stablelabs/agentic.stable.xyz/blob/21ca30d540ba2f14c56b41e2b1aaa57348312c01/scripts/enable-account.ts), [wallet guide](https://github.com/stablelabs/agentic.stable.xyz/blob/21ca30d540ba2f14c56b41e2b1aaa57348312c01/docs/wallet.md).
- The allowance implementation replaced the custom account flow in [commit `32e721c`](https://github.com/stablelabs/agentic.stable.xyz/commit/32e721c81b031e43b07bb45d6a307f1c42dc18e1).
