import { loadConfig, args, required, newId } from './local';
import { parseGrantDraft } from '../client/grant-input';
import { identifier } from '../client/config';

try {
  const opt = args(['agent', 'recipient', 'budget', 'expires', 'grant-id']);
  const c = await loadConfig();
  const draft = { id: opt['grant-id'] ? identifier(opt['grant-id']) : newId(), agent: opt.agent || required(c.defaultAgent, 'agent'), recipient: required(opt.recipient, 'recipient'), budget: required(opt.budget, 'budget'), expires: required(opt.expires, 'expires') };
  parseGrantDraft(draft, c.alice, BigInt(Math.floor(Date.now() / 1000)));
  const link = new URL(c.approvalUrl);
  for (const [key, value] of Object.entries({ newGrant: draft.id, agent: draft.agent, recipient: draft.recipient, budget: draft.budget, expires: draft.expires })) link.searchParams.set(key, value);
  console.log(`Alice creates and authorizes this grant in MetaMask:\n${link.href}\nGrant ID: ${draft.id}\nNo transaction was signed or submitted.`);
} catch (e) { console.error(e instanceof Error ? e.message : 'Could not create grant form link.'); process.exitCode = 1; }
