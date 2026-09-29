import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { sampleInput, type Session, type Quote, type Run } from '../shared/contracts';
const origin = process.env.PUBLIC_ORIGIN || 'http://localhost:5173';
let cookie = '';
async function api<T>(path: string, body?: unknown, key?: string): Promise<T> {
  const res = await fetch(`${origin}/api/agentic/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  cookie = res.headers.get('set-cookie')?.split(';')[0] || cookie;
  const data = await res.json();
  if (!res.ok) throw new Error(`${data.error?.code}: ${data.error?.message}`);
  return data;
}
const caps = await api<{ environment: string; services: { available: boolean }[] }>(
  '/capabilities',
);
assert.equal(caps.environment, 'testnet');
if (!caps.services[0].available)
  throw new Error(
    'LIVE_ACCEPTANCE_BLOCKED: enable PAYMENTS_ENABLED with dedicated funded testnet credentials. No payment was attempted.',
  );
let session = await api<Session>('/sessions', {}, randomUUID());
for (let i = 0; session.status === 'funding' && i < 60; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  session = await api<Session>('/session');
}
assert.equal(session.status, 'ready');
assert.equal(session.activeRunId, null);
const quote = await api<Quote>('/quotes', sampleInput);
const key = randomUUID();
let run = await api<Run>('/runs', { quoteId: quote.id }, key);
const duplicate = await api<Run>('/runs', { quoteId: quote.id }, key);
assert.equal(duplicate.id, run.id);
for (let i = 0; run.status !== 'completed' && i < 90; i++) {
  if (['failed', 'blocked'].includes(run.status)) throw new Error(JSON.stringify(run.error));
  await new Promise((r) => setTimeout(r, 2000));
  run = await api<Run>(`/runs/${run.id}`);
}
assert.equal(run.status, 'completed');
assert.equal(run.result?.total, '50.00');
assert.ok(run.receipt);
const replay = await api<Run>(`/runs/${run.id}/resume`, {}, randomUUID());
assert.equal(replay.txHash, run.txHash);
assert.deepEqual(replay.result, run.result);
const explorer = await fetch(run.receipt.explorerUrl);
assert.ok(explorer.ok, 'Explorer must resolve the real receipt URL.');
mkdirSync('evidence/live', { recursive: true });
writeFileSync(
  `evidence/live/${run.id}.json`,
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      run,
      retryHash: replay.txHash,
      explorerStatus: explorer.status,
    },
    null,
    2,
  ),
);
console.log(`Live API purchase verified: ${run.id}. Receipt: ${run.receipt.explorerUrl}`);
