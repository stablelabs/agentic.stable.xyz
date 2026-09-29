import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Server } from 'node:http';
import { configFromEnv } from '../server/config';
import { Engine } from '../server/engine';
import { Store } from '../server/store';
import { createApp } from '../server/app';
import { FakeChain } from './fake-chain';
import { sampleInput } from '../shared/contracts';
const store = new Store(':memory:');
const config = {
  ...configFromEnv(),
  enabled: true,
  encryptionKey: 'ba'.repeat(32),
  fundingKey: generatePrivateKey(),
  payee: '0x1234567890123456789012345678901234567890',
  sessionRate: 100,
};
const engine = new Engine(store, new FakeChain(), config);
let server: Server;
let base: string;
beforeAll(async () => {
  await engine.readiness();
  server = createApp(engine).listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  store.close();
});
async function request(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Origin: config.origin, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
describe('HTTP boundaries', () => {
  it('rejects invalid origin, malformed input, and missing authentication', async () => {
    expect(
      (await request('/api/agentic/v1/sessions', {}, { Origin: 'https://evil.example' })).status,
    ).toBe(403);
    expect(
      (
        await request(
          '/api/agentic/v1/sessions',
          { payer: config.payee },
          { 'Idempotency-Key': randomUUID() },
        )
      ).status,
    ).toBe(400);
    expect((await request('/api/agentic/v1/session')).status).toBe(401);
  });
  it('sets restricted cookies and recovers duplicate requests without exposing signer material', async () => {
    const key = randomUUID();
    const first = await request('/api/agentic/v1/sessions', {}, { 'Idempotency-Key': key });
    expect(first.status).toBe(201);
    const cookie = first.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/api/agentic/v1');
    expect(cookie).toContain('SameSite=Lax');
    const initial = await first.json();
    expect(initial).not.toHaveProperty('key');
    const second = await request('/api/agentic/v1/sessions', {}, { 'Idempotency-Key': key });
    expect((await second.json()).id).toBe(initial.id);
    await engine.tick();
    const headers = { Cookie: cookie.split(';')[0] };
    const quote = await (await request('/api/agentic/v1/quotes', sampleInput, headers)).json();
    const runKey = randomUUID();
    const runHeaders = { ...headers, 'Idempotency-Key': runKey };
    const a = await (
      await request('/api/agentic/v1/runs', { quoteId: quote.id }, runHeaders)
    ).json();
    const b = await (
      await request('/api/agentic/v1/runs', { quoteId: quote.id }, runHeaders)
    ).json();
    expect(a.id).toBe(b.id);
    await engine.tick();
    const resultResponse = await request(`/api/agentic/v1/runs/${a.id}`, undefined, headers);
    expect(resultResponse.headers.get('cache-control')).toBe('no-store');
    expect((await resultResponse.json()).status).toBe('completed');
  });
  it('authenticates a standalone wallet and rejects challenge replay or unowned orders', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const challenge = await (
      await request('/api/seller/v1/challenge', { address: account.address })
    ).json();
    const body = {
      challengeId: challenge.id,
      signature: await account.signMessage({ message: challenge.message }),
    };
    const auth = await (await request('/api/seller/v1/authenticate', body)).json();
    expect((await request('/api/seller/v1/authenticate', body)).status).toBe(401);
    const headers = { Authorization: `Bearer ${auth.token}`, 'Idempotency-Key': randomUUID() };
    const quote = await (await request('/api/seller/v1/quotes', sampleInput, headers)).json();
    expect(quote.payer).toBe(account.address.toLowerCase());
    expect((await request(`/api/seller/v1/orders/${quote.id}`)).status).toBe(401);
    const result = await (
      await request(`/api/seller/v1/orders/${quote.id}`, undefined, headers)
    ).json();
    expect(result.receipt).toBeNull();
    expect(result.result).toBeNull();
  });
  it('serves production guides and never has a fixture success endpoint', async () => {
    const doc = await fetch(base + '/docs/quickstart/');
    expect(doc.status).toBe(200);
    expect(await doc.text()).toContain('Run the Stable agentic demo');
    expect((await request('/api/fixtures/completed')).status).toBe(404);
  });
});
