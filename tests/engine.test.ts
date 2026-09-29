import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { generatePrivateKey } from 'viem/accounts';
import { configFromEnv } from '../server/config';
import { Engine, type RunRecord, type SessionRecord } from '../server/engine';
import { Store } from '../server/store';
import { FakeChain } from './fake-chain';
import { money } from '../shared/contracts';
import { extractInvoice } from '../server/seller/service';
const stores: Store[] = [];
function setup() {
  const store = new Store(':memory:');
  stores.push(store);
  const chain = new FakeChain();
  const config = {
    ...configFromEnv(),
    enabled: true,
    encryptionKey: 'ab'.repeat(32),
    fundingKey: generatePrivateKey(),
    payee: '0x1234567890123456789012345678901234567890',
    sessionRate: 20,
  };
  return { engine: new Engine(store, chain, config), chain, store };
}
async function ready(engine: Engine) {
  await engine.readiness();
  const id = engine.createSession(randomUUID(), randomUUID());
  await engine.tick();
  expect(engine.session(id).status).toBe('ready');
  return id;
}
afterEach(() => {
  stores.splice(0).forEach((s) => s.close());
  vi.restoreAllMocks();
});
describe('durable purchase accounting', () => {
  it('opening a funded session does not purchase; repeated provisioning funds once', async () => {
    const { engine, chain } = setup();
    await engine.readiness();
    const key = randomUUID();
    const id = engine.createSession(key, 'ip');
    expect(engine.createSession(key, 'ip')).toBe(id);
    await engine.tick();
    await engine.tick();
    expect(chain.prepared).toHaveLength(1);
    expect(engine.session(id).activeRunId).toBeNull();
  });
  it('duplicate mutations pay once and budgets include actual gas', async () => {
    const { engine, chain } = setup();
    const id = await ready(engine);
    const q = engine.quote(id);
    const key = randomUUID();
    const a = engine.start(id, q.id, key);
    const b = engine.start(id, q.id, key);
    expect(b.id).toBe(a.id);
    expect(engine.session(id).budget.reserved).toEqual(q.maxTotal);
    await engine.tick();
    const r = engine.run(a.id, id);
    expect(r.status).toBe('completed');
    expect(r.result?.vendor).toBe('Example Studio');
    expect(r.session.budget.spent.amountAtomic).toBe(String(engine.config.price + 1000n));
    expect(r.session.budget.reserved.amountAtomic).toBe('0');
    engine.resume(a.id, id, randomUUID());
    await engine.tick();
    expect(chain.prepared).toHaveLength(2);
  });
  it('rejects a second concurrent run and conflicting keys', async () => {
    const { engine } = setup();
    const id = await ready(engine);
    const q1 = engine.quote(id),
      q2 = engine.quote(id);
    const key = randomUUID();
    engine.start(id, q1.id, key);
    expect(() => engine.start(id, q2.id, randomUUID())).toThrow('already active');
    expect(() => engine.start(id, q2.id, key)).toThrow('different terms');
  });
  it('cannot purchase an already consumed quote using a new key', async () => {
    const { engine, store, chain } = setup();
    const id = await ready(engine);
    const q = engine.quote(id);
    engine.start(id, q.id, randomUUID());
    await engine.tick();
    expect(() => engine.start(id, q.id, randomUUID())).toThrow('already purchased');
    expect(store.db.prepare('SELECT * FROM active_runs').all()).toHaveLength(0);
    expect(chain.prepared).toHaveLength(2);
  });
  it('enforces cumulative budget atomically', async () => {
    const { engine } = setup();
    const id = await ready(engine);
    for (let i = 0; i < 3; i++) {
      const q = engine.quote(id);
      engine.start(id, q.id, randomUUID());
      await engine.tick();
    }
    const q = engine.quote(id);
    expect(() => engine.start(id, q.id, randomUUID())).toThrow('remaining demo budget');
  });
  it('rejects expired or changed quote and insufficient balance before signing', async () => {
    const { engine, store, chain } = setup();
    const id = await ready(engine);
    const q = engine.quote(id);
    const order = engine.seller.order(q.id, id);
    order.quote.expiresAt = new Date(0).toISOString();
    store.put('orders', q.id, order);
    expect(() => engine.start(id, q.id, randomUUID())).toThrow('expired');
    const q2 = engine.quote(id);
    const changed = engine.seller.order(q2.id, id);
    changed.quote.price = money(1n);
    store.put('orders', q2.id, changed);
    expect(() => engine.start(id, q2.id, randomUUID())).toThrow('Terms changed');
    const s = store.get<SessionRecord>('sessions', id)!;
    s.view.balance = money(0n);
    store.put('sessions', id, s);
    expect(() => engine.start(id, engine.quote(id).id, randomUUID())).toThrow('Insufficient');
    expect(chain.prepared).toHaveLength(1);
  });
  it('recovers a lost broadcast response with the original signed transaction', async () => {
    const { engine, chain, store } = setup();
    const id = await ready(engine);
    const q = engine.quote(id);
    const r = engine.start(id, q.id, randomUUID());
    chain.pending = true;
    chain.lostResponse = true;
    await engine.tick();
    expect(engine.run(r.id, id).status).toBe('payment_unknown');
    expect(engine.session(id).budget.reserved).toEqual(q.maxTotal);
    expect(store.get<RunRecord>('runs', r.id)?.prepared?.hash).toBeTruthy();
    const restarted = new Engine(store, chain, engine.config);
    chain.pending = false;
    chain.lostResponse = false;
    await restarted.tick();
    expect(restarted.run(r.id, id).status).toBe('completed');
    expect(chain.prepared).toHaveLength(2);
  });
  it('reconciles reverted payments with gas only', async () => {
    const { engine, chain } = setup();
    const id = await ready(engine);
    const r = engine.start(id, engine.quote(id).id, randomUUID());
    chain.revert = true;
    await engine.tick();
    const result = engine.run(r.id, id);
    expect(result.status).toBe('failed');
    expect(result.receipt).toBeNull();
    expect(result.session.budget.spent.amountAtomic).toBe('1000');
    expect(result.session.budget.reserved.amountAtomic).toBe('0');
  });
  it('retries paid delivery without another payment and preserves the receipt', async () => {
    const { engine, chain } = setup();
    const id = await ready(engine);
    const r = engine.start(id, engine.quote(id).id, randomUUID());
    const stub = vi.spyOn(engine.seller, 'deliver').mockImplementationOnce(() => {
      throw new Error('disk temporarily unavailable');
    });
    await engine.tick();
    expect(engine.run(r.id, id).status).toBe('delivery_failed');
    expect(engine.run(r.id, id).receipt).not.toBeNull();
    stub.mockRestore();
    engine.resume(r.id, id, randomUUID());
    await engine.tick();
    expect(engine.run(r.id, id).status).toBe('completed');
    expect(chain.prepared).toHaveLength(2);
  });
  it('session expiry prevents new spending but still reconciles submitted payments', async () => {
    const { engine, chain, store } = setup();
    const id = await ready(engine);
    const r = engine.start(id, engine.quote(id).id, randomUUID());
    chain.pending = true;
    await engine.tick();
    const s = store.get<SessionRecord>('sessions', id)!;
    s.view.expiresAt = new Date(0).toISOString();
    store.put('sessions', id, s);
    expect(() => engine.authenticate(engine.cookie(id))).toThrow('expired');
    chain.pending = false;
    await engine.tick();
    expect(engine.run(r.id, id).status).toBe('completed');
  });
  it('isolates sessions and consumes each payment once', async () => {
    const { engine, store } = setup();
    const a = await ready(engine),
      b = await ready(engine);
    const r = engine.start(a, engine.quote(a).id, randomUUID());
    expect(() => engine.run(r.id, b)).toThrow('not found');
    expect(() => engine.seller.order(r.quoteId, b)).toThrow('not found');
    await engine.tick();
    const hash = engine.run(r.id, a).txHash!;
    expect(() => store.consume(hash, randomUUID())).toThrow('another order');
  });
  it('limits funding globally and by requester', async () => {
    const { engine } = setup();
    await engine.readiness();
    engine.config.sessionRate = 1;
    engine.createSession(randomUUID(), 'same');
    expect(() => engine.createSession(randomUUID(), 'same')).toThrow('wait');
    engine.config.fundingCap = engine.config.fund;
    expect(() => engine.createSession(randomUUID(), 'other')).toThrow('allowance');
  });
  it('does not expose plaintext session keys and rejects forged cookies', async () => {
    const { engine, store } = setup();
    const id = await ready(engine);
    const s = store.get<SessionRecord>('sessions', id)!;
    expect(s.key).not.toMatch(/^0x/);
    expect(JSON.stringify(engine.session(id))).not.toContain(s.key);
    expect(() => engine.authenticate(engine.cookie(id).slice(0, -1) + 'x')).toThrow('unavailable');
  });
  it('executes sample extraction and rejects inconsistent source values', () => {
    expect(extractInvoice().total).toBe('50.00');
    expect(() =>
      extractInvoice(
        'Vendor: Test\nInvoice: A\nCurrency: USD\nItem: Test | 2 | 25.00 | 49.00\nTotal: 49.00',
      ),
    ).toThrow('reconcile');
  });
});
