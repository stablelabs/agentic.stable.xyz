import { type Hex } from 'viem';
import { address, identifier } from './config.js';
import { parseAmount } from './amount.js';

export type GrantDraft = { id: Hex; agent: string; recipient: string; budget: string; expires: string };
export function newGrantId(): Hex {
  return `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
export function parseGrantDraft(draft: GrantDraft, alice: string, now: bigint) {
  const id = identifier(draft.id);
  const agent = address(draft.agent, 'agent signer');
  const recipient = address(draft.recipient, 'recipient');
  if (agent.toLowerCase() === alice.toLowerCase() || recipient.toLowerCase() === alice.toLowerCase()) throw new Error('Use a separate agent signer and recipient from Alice.');
  const budget = parseAmount(draft.budget);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(draft.expires)) throw new Error('Expiry must be a UTC timestamp, e.g. 2026-10-15T18:00:00Z.');
  const ms = Date.parse(draft.expires);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().replace('.000Z', 'Z') !== draft.expires) throw new Error('Invalid expiry date.');
  const expiresAt = BigInt(ms / 1000);
  if (expiresAt <= now) throw new Error('Expiry must be in the future.');
  return { id, agent, recipient, budget, expiresAt };
}
