import { DurableObject } from 'cloudflare:workers';
import { handleAsNodeRequest } from 'cloudflare:node';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { DurableLedger } from '../store';
import { Engine } from '../../server/engine';
import { configFromEnv } from '../../server/config';
import { FakeChain } from '../../tests/fake-chain';
import { createApp } from '../../server/app';

// Only the local test harness bundles this module. It is not a deployment entry point.
export class TestLedger extends DurableObject {
  async fetch(request: Request) {
    const store = new DurableLedger(this.ctx.storage);
    if (new URL(request.url).pathname === '/verify') {
      const saved = store.get<{ runId: string; sessionId: string }>('test', 'completed');
      assert.ok(saved);
      const state = store.get<{ view: { status: string } }>('runs', saved.runId);
      assert.equal(state?.view.status, 'completed');
      assert.equal(store.get('test', 'rolled-back'), undefined);
      return Response.json({ persistedAfterRestart: true });
    }
    const chain = new FakeChain();
    const config = configFromEnv('site', {
      PAYMENTS_ENABLED: 'true',
      SESSION_ENCRYPTION_KEY: 'ab'.repeat(32),
      FUNDING_PRIVATE_KEY: `0x${'11'.repeat(32)}`,
      SELLER_ADDRESS: '0x1234567890123456789012345678901234567890',
    });
    const engine = new Engine(store, chain, config);
    assert.throws(
      () =>
        store.atomic(() => {
          store.put('test', 'rolled-back', true);
          throw new Error('rollback');
        }),
      /rollback/,
    );
    assert.equal(store.get('test', 'rolled-back'), undefined);
    await engine.readiness();
    const sessionKey = crypto.randomUUID();
    const id = engine.createSession(sessionKey, 'fixture');
    assert.equal(engine.createSession(sessionKey, 'fixture'), id);
    await engine.tick();
    assert.equal(engine.session(id).status, 'ready');
    assert.equal(chain.prepared.length, 1);
    const quote = engine.quote(id);
    const otherQuote = engine.quote(id);
    const key = crypto.randomUUID();
    const run = engine.start(id, quote.id, key);
    assert.equal(engine.start(id, quote.id, key).id, run.id);
    assert.throws(() => engine.start(id, otherQuote.id, crypto.randomUUID()), /already active/);
    chain.pending = true;
    chain.lostResponse = true;
    await engine.tick();
    assert.equal(engine.run(run.id, id).status, 'payment_unknown');
    assert.deepEqual(engine.session(id).budget.reserved, quote.maxTotal);
    const restarted = new Engine(new DurableLedger(this.ctx.storage), chain, config);
    chain.pending = false;
    chain.lostResponse = false;
    await restarted.tick();
    const result = restarted.run(run.id, id);
    assert.equal(result.status, 'completed');
    assert.equal(result.result?.total, '50.00');
    assert.equal(result.session.budget.spent.amountAtomic, String(config.price + 1000n));
    assert.equal(result.session.budget.reserved.amountAtomic, '0');
    restarted.resume(run.id, id, crypto.randomUUID());
    await restarted.tick();
    assert.equal(chain.prepared.length, 2);
    assert.throws(() => store.consume(result.txHash!, crypto.randomUUID()), /another order/);
    const server = createServer(createApp(restarted, false, { apiOnly: true }));
    server.listen(0);
    try {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const response = await handleAsNodeRequest(
        address.port,
        new Request(`https://test/api/agentic/v1/runs/${run.id}`, {
          headers: {
            Cookie: `agentic_session=${restarted.cookie(id)}`,
            'Accept-Encoding': 'br, gzip',
          },
        }),
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-encoding'), null);
      const body = await response.text();
      assert.ok(body.length > 1024, 'Exercise the Express compression threshold.');
      assert.equal(JSON.parse(body).status, 'completed');
    } finally {
      server.close();
    }
    store.put('test', 'completed', { runId: run.id, sessionId: id });
    await store.flush();
    return Response.json({
      rollback: true,
      idempotency: true,
      concurrentExclusion: true,
      unknownRecovery: true,
      actualFeeAccounting: true,
      deliveryRetryWithoutRepayment: true,
      oneTimePaymentEvidence: true,
      httpBridgeEncoding: true,
      fixtureOnly: true,
    });
  }
}
