import { formatAmount, address, identifier, parseGrantDraft, type GrantDraft, readGrant, duration, input, WalletError } from '@stablechain/agent-wallet-sdk/protocol';
import { newId } from './state.js';
import type { AgentContext } from './context.js';

type DraftRecord = { schemaVersion: 1; alice: string; draft: GrantDraft; expiresIn?: string };
export async function grantLink(ctx: AgentContext, opt: Record<string, string | boolean | undefined>) {
  return ctx.state.lock(async () => {
    const config = await ctx.config();
    const id = input(() => identifier(String(opt['grant-id'] || newId())));
    const path = `grant-draft-${id}.json`;
    const previous = await ctx.state.has(path) ? await ctx.state.read<DraftRecord>(path) : undefined;
    if (Boolean(opt.expires) === Boolean(opt['expires-in'])) throw new WalletError('INVALID_INPUT', 'Supply exactly one of --expires or --expires-in.', 2);
    if (!opt.recipient || !opt.budget) throw new WalletError('INVALID_INPUT', '--recipient and --budget are required.', 2);
    const expiresIn = opt['expires-in'] ? String(opt['expires-in']) : undefined;
    const expires = opt.expires ? String(opt.expires) : previous && previous.expiresIn === expiresIn ? previous.draft.expires : new Date(Date.now() + duration(expiresIn!, 'expiry duration')).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const agent = opt.agent ? input(() => address(String(opt.agent))) : await ctx.identity();
    const draft: GrantDraft = { id, agent, recipient: String(opt.recipient), budget: String(opt.budget), expires };
    const terms = input(() => parseGrantDraft(draft, config.alice, previous ? 0n : BigInt(Math.floor(Date.now() / 1000))));
    draft.agent = terms.agent; draft.recipient = terms.recipient; draft.budget = formatAmount(terms.budget);
    if (previous && (previous.alice !== config.alice || JSON.stringify(previous.draft) !== JSON.stringify(draft) || previous.expiresIn !== expiresIn)) throw new WalletError('GRANT_DRAFT_MISMATCH', 'Grant ID is already bound to different terms.', 2);
    if (!previous) await ctx.state.write(path, { schemaVersion: 1, alice: config.alice, draft, ...(expiresIn ? { expiresIn } : {}) });
    const link = new URL(config.approvalUrl);
    for (const [key, value] of Object.entries({ newGrant: id, agent: draft.agent, recipient: draft.recipient, budget: draft.budget, expires: draft.expires })) link.searchParams.set(key, value);
    return { grantId: id, approvalUrl: link.href, terms: draft, status: 'awaiting_owner', submitted: false };
  });
}

export async function waitGrant(ctx: AgentContext, idText: string, timeout = 300_000) {
  const id = input(() => identifier(idText));
  const { config, client } = await ctx.public();
  await ctx.verify(client, config);
  const saved = await ctx.state.has(`grant-draft-${id}.json`) ? await ctx.state.read<DraftRecord>(`grant-draft-${id}.json`) : undefined;
  const deadline = Date.now() + timeout;
  while (true) {
    const row = await readGrant(client, config, id);
    if (row.grant.status !== 0 && saved) {
      const terms = input(() => parseGrantDraft(saved.draft, config.alice, 0n)), g = row.grant;
      if (saved.alice !== config.alice || terms.agent !== g.agent || terms.recipient !== g.recipient || terms.budget !== g.budget || terms.expiresAt !== g.expiresAt) throw new WalletError('GRANT_TERMS_MISMATCH', 'Onchain grant differs from the saved approval terms.', 4, row);
    }
    if (row.status === 'Active') {
      if (row.grant.agent !== await ctx.identity()) throw new WalletError('WRONG_SIGNER', 'Grant belongs to a different agent.', 4, row);
      return row;
    }
    if (!['Unknown', 'Pending'].includes(row.status)) throw new WalletError('GRANT_NOT_PAYABLE', `Grant is ${row.status}.`, 4, row);
    if (Date.now() >= deadline) throw new WalletError('GRANT_WAIT_TIMEOUT', 'Authorization is still pending. Check the same grant ID later.', 6, row);
    await new Promise(resolve => setTimeout(resolve, Math.min(1000, deadline - Date.now())));
  }
}
