import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import {
  asset,
  formatMoney,
  money,
  network,
  type Quote,
  type Run,
  type RunStatus,
  type Session,
} from '../shared/contracts';
import { decrypt, digest, encrypt } from './crypto';
import { AppError, requireThat } from './errors';
import type { Config } from './config';
import type { Store } from './store';
import { binding, type PaymentChain, type Prepared } from './payments/chain';
import { Seller } from './seller/seller';

export type SessionRecord = {
  view: Session;
  key: string;
  fundingQuote: Quote | null;
  funding: Prepared | null;
  fundingDone: boolean;
};
export type RunRecord = {
  view: Omit<Run, 'session'>;
  sessionId: string;
  prepared: Prepared | null;
  accounted: boolean;
};
const terminal: RunStatus[] = ['completed', 'blocked', 'failed'];
export class Engine {
  seller: Seller;
  private working = false;
  private ready = false;
  constructor(
    public store: Store,
    public chain: PaymentChain,
    public config: Config,
  ) {
    this.seller = new Seller(store, chain, config);
  }
  async readiness() {
    if (!this.config.enabled) {
      this.ready = false;
      return false;
    }
    try {
      await this.chain.verifyNetwork();
      this.ready = true;
    } catch {
      this.ready = false;
    }
    return this.ready;
  }
  async fundingReadiness() {
    if (!this.config.enabled || !this.config.fundingKey) return false;
    try {
      const address = privateKeyToAccount(this.config.fundingKey as Hex).address;
      return (await this.chain.balance(address)) >= this.config.fund + this.config.maxFee;
    } catch {
      return false;
    }
  }
  capabilities() {
    return {
      contractVersion: 'site-demo/v1',
      environment: 'testnet',
      network,
      asset,
      services: [
        {
          id: 'invoice-extract',
          name: 'Invoice extraction',
          description: 'Extract structured data from a sample invoice.',
          sampleIds: ['sample-invoice-01'],
          available: this.config.enabled && this.ready,
        },
      ],
      links: {
        quickstart: '/docs/quickstart',
        agentSetup: '/docs/agent-setup',
        sellerGuide: '/docs/accept-payments',
        repository: this.config.repository || null,
      },
    };
  }
  cookie(id: string) {
    return `${id}.${createHmac('sha256', this.config.encryptionKey).update(id).digest('hex')}`;
  }
  authenticate(token?: string) {
    if (!token || token.length > 200)
      throw new AppError('SESSION_EXPIRED', 'Start a new testnet session.', 401);
    const id = token.split('.')[0];
    const expected = this.cookie(id);
    if (
      token.length !== expected.length ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(expected))
    )
      throw new AppError('SESSION_EXPIRED', 'Session is unavailable.', 401);
    const session = this.session(id);
    requireThat(
      Date.parse(session.expiresAt) > Date.now(),
      'SESSION_EXPIRED',
      'This session has expired. Submitted payments continue reconciling.',
      401,
    );
    return id;
  }
  session(id: string): Session {
    const record = this.store.get<SessionRecord>('sessions', id);
    requireThat(record, 'SESSION_EXPIRED', 'Session is unavailable.', 401);
    const view = record.view;
    const remaining =
      BigInt(view.budget.limit.amountAtomic) -
      BigInt(view.budget.spent.amountAtomic) -
      BigInt(view.budget.reserved.amountAtomic);
    requireThat(
      remaining >= 0n,
      'ACCOUNTING_ERROR',
      'Session requires operator reconciliation.',
      503,
    );
    view.budget.remaining = money(remaining);
    if (Date.parse(view.expiresAt) <= Date.now()) view.status = 'expired';
    return view;
  }
  createSession(key: string, ip: string): string {
    requireThat(
      this.config.enabled && this.ready,
      'FUNDING_UNAVAILABLE',
      'The testnet demo is temporarily unavailable. The guides are still available.',
      503,
    );
    return this.store.once('provision', '/sessions', key, '{}', () => {
      this.store.rate(`fund:${ip}`, this.config.sessionRate);
      const committed = this.store.get<{ amount: string }>('meta', 'funding') || { amount: '0' };
      const cost = this.config.fund + this.config.maxFee;
      requireThat(
        BigInt(committed.amount) + cost <= this.config.fundingCap,
        'FUNDING_UNAVAILABLE',
        'The demo funding allowance is currently exhausted.',
        503,
      );
      committed.amount = String(BigInt(committed.amount) + cost);
      this.store.put('meta', 'funding', committed);
      const id = randomUUID();
      const secret = generatePrivateKey();
      const view: Session = {
        id,
        mode: 'testnet',
        status: 'funding',
        expiresAt: new Date(Date.now() + this.config.sessionMs).toISOString(),
        network,
        asset,
        walletAddress: privateKeyToAccount(secret).address,
        balance: money(0n),
        budget: {
          limit: money(this.config.budget),
          spent: money(0n),
          reserved: money(0n),
          remaining: money(this.config.budget),
        },
        activeRunId: null,
      };
      this.store.put('sessions', id, {
        view,
        key: encrypt(secret, this.config.encryptionKey, id),
        funding: null,
        fundingQuote: null,
        fundingDone: false,
      } satisfies SessionRecord);
      return id;
    });
  }
  quote(sessionId: string) {
    const s = this.session(sessionId);
    requireThat(
      s.status === 'ready',
      'FUNDING_UNAVAILABLE',
      'Your testnet wallet is not ready yet.',
      503,
    );
    requireThat(
      !s.activeRunId || terminal.includes(this.run(s.activeRunId, sessionId).status),
      'RUN_IN_PROGRESS',
      'Recover the current purchase first.',
    );
    requireThat(
      this.ready,
      'SERVICE_UNAVAILABLE',
      'The testnet service is temporarily unavailable.',
      503,
    );
    return this.seller.quote(sessionId, s.walletAddress);
  }
  start(sessionId: string, quoteId: string, key: string) {
    const id = this.store.once(sessionId, '/runs', key, digest({ quoteId }), () => {
      const session = this.session(sessionId);
      requireThat(
        session.status === 'ready',
        'SESSION_EXPIRED',
        'Session is not ready for a purchase.',
        401,
      );
      const q = this.seller.order(quoteId, sessionId).quote;
      requireThat(
        Date.parse(q.expiresAt) > Date.now(),
        'QUOTE_EXPIRED',
        'This quote expired. Review a new quote.',
      );
      requireThat(
        q.payer === session.walletAddress &&
          q.payee === this.config.payee &&
          q.price.amountAtomic === String(this.config.price) &&
          q.maxNetworkFee.amountAtomic === String(this.config.maxFee),
        'QUOTE_CHANGED',
        'Terms changed. Review a new quote.',
      );
      requireThat(
        !this.store.db.prepare('SELECT run_id FROM active_runs WHERE session_id=?').get(sessionId),
        'RUN_IN_PROGRESS',
        'A purchase is already active.',
      );
      requireThat(
        !this.store.db.prepare('SELECT run_id FROM accepted_quotes WHERE quote_id=?').get(quoteId),
        'QUOTE_USED',
        'This quote was already purchased. Review a fresh quote.',
      );
      const reserve = BigInt(q.maxTotal.amountAtomic);
      requireThat(
        BigInt(session.budget.remaining.amountAtomic) >= reserve,
        'BUDGET_EXCEEDED',
        'This purchase exceeds your remaining demo budget.',
      );
      requireThat(
        BigInt(session.balance.amountAtomic) >= reserve,
        'INSUFFICIENT_FUNDS',
        'Insufficient testnet balance.',
      );
      const id = randomUUID();
      session.budget.reserved = money(BigInt(session.budget.reserved.amountAtomic) + reserve);
      session.activeRunId = id;
      const record = this.store.get<SessionRecord>('sessions', sessionId)!;
      record.view = session;
      this.store.put('sessions', sessionId, record);
      this.store.db.prepare('INSERT INTO active_runs VALUES(?,?)').run(sessionId, id);
      this.store.db.prepare('INSERT INTO accepted_quotes VALUES(?,?)').run(quoteId, id);
      const view: RunRecord['view'] = {
        id,
        purchaseId: q.id,
        quoteId,
        status: 'queued',
        events: [
          { seq: 1, at: new Date().toISOString(), status: 'queued', message: 'Purchase queued.' },
        ],
        txHash: null,
        receipt: null,
        result: null,
        error: null,
      };
      this.store.put('runs', id, {
        view,
        sessionId,
        prepared: null,
        accounted: false,
      } satisfies RunRecord);
      return id;
    });
    return this.run(id, sessionId);
  }
  run(id: string, sessionId: string): Run {
    const r = this.store.get<RunRecord>('runs', id);
    requireThat(r && r.sessionId === sessionId, 'NOT_FOUND', 'Run not found.', 404);
    return { ...r.view, session: this.session(sessionId) };
  }
  resume(id: string, sessionId: string, key: string) {
    this.store.once(sessionId, `/runs/${id}/resume`, key, '{}', () => {
      this.run(id, sessionId);
      return id;
    });
    return this.run(id, sessionId);
  }
  event(r: RunRecord, status: RunStatus, message: string) {
    if (r.view.status !== status)
      r.view.events.push({
        seq: r.view.events.length + 1,
        at: new Date().toISOString(),
        status,
        message,
      });
    r.view.status = status;
    this.store.atomic(() => {
      this.store.put('runs', r.view.id, r);
      if (terminal.includes(status))
        this.store.db.prepare('DELETE FROM active_runs WHERE run_id=?').run(r.view.id);
    });
  }
  reconcile(r: RunRecord, spent: bigint) {
    this.store.atomic(() => {
      if (this.store.get<RunRecord>('runs', r.view.id)!.accounted) {
        r.accounted = true;
        return;
      }
      const s = this.store.get<SessionRecord>('sessions', r.sessionId)!;
      const q = this.seller.order(r.view.quoteId, r.sessionId).quote;
      s.view.budget.reserved = money(
        BigInt(s.view.budget.reserved.amountAtomic) - BigInt(q.maxTotal.amountAtomic),
      );
      s.view.budget.spent = money(BigInt(s.view.budget.spent.amountAtomic) + spent);
      s.view.balance = money(BigInt(s.view.balance.amountAtomic) - spent);
      r.accounted = true;
      this.store.put('sessions', r.sessionId, s);
      this.store.put('runs', r.view.id, r);
    });
  }
  async processRun(r: RunRecord) {
    const q = this.seller.order(r.view.quoteId, r.sessionId).quote;
    try {
      if (!r.prepared) {
        this.event(r, 'authorizing', 'Checking purchase permissions.');
        const s = this.store.get<SessionRecord>('sessions', r.sessionId)!;
        requireThat(
          Date.parse(s.view.expiresAt) > Date.now(),
          'SESSION_EXPIRED',
          'Session expired before payment submission.',
        );
        r.prepared = await this.chain.prepare(
          decrypt(s.key, this.config.encryptionKey, r.sessionId) as Hex,
          q.payee,
          BigInt(q.price.amountAtomic),
          binding(q),
          BigInt(q.maxNetworkFee.amountAtomic),
        );
        r.view.txHash = r.prepared.hash;
        this.store.put('runs', r.view.id, r);
      }
      if (!r.view.receipt) {
        let settlement = await this.chain.settlement(r.prepared.hash, q);
        if (!settlement) {
          await this.chain.broadcast(r.prepared.raw);
          this.event(r, 'submitted', 'Payment submitted.');
          this.event(r, 'confirming', 'Waiting for settlement confirmation.');
          settlement = await this.chain.settlement(r.prepared.hash, q);
        }
        if (!settlement) return;
        if (!settlement.success) {
          this.reconcile(r, BigInt(settlement.fee));
          r.view.error = {
            code: 'PAYMENT_REVERTED',
            message: `Payment reverted. Network fee spent: ${formatMoney(money(settlement.fee), asset.decimals)} USDT0.`,
            retryable: false,
          };
          this.event(r, 'failed', 'Payment reverted; network fee recorded.');
          return;
        }
        r.view.receipt = await this.seller.verify(q.id, r.sessionId, r.prepared.hash);
        this.reconcile(r, BigInt(r.view.receipt.totalPaid.amountAtomic));
        this.event(r, 'settled', 'Payment settled and verified.');
      }
      this.event(r, 'delivering', 'Retrieving the invoice extraction result.');
      r.view.result = this.seller.deliver(q.id, r.sessionId).result;
      r.view.error = null;
      this.event(r, 'completed', 'Invoice extraction delivered.');
    } catch (error) {
      const e =
        error instanceof AppError
          ? error
          : new AppError(
              'RPC_UNAVAILABLE',
              'The testnet service is temporarily unavailable.',
              503,
              true,
            );
      r.view.error = { code: e.code, message: e.message, retryable: e.retryable };
      if (r.view.receipt) {
        r.view.error = {
          code: 'DELIVERY_FAILED',
          message: 'Payment settled; result delivery needs another attempt.',
          retryable: true,
        };
        this.event(r, 'delivery_failed', r.view.error.message);
      } else if (r.prepared) {
        r.view.error = {
          code: 'PAYMENT_UNKNOWN',
          message: 'Checking payment status. Your reservation is preserved.',
          retryable: true,
        };
        this.event(r, 'payment_unknown', r.view.error.message);
      } else {
        this.reconcile(r, 0n);
        this.event(r, 'blocked', e.message);
      }
    }
  }
  async processFunding(s: SessionRecord) {
    const c = this.config;
    try {
      if (!s.funding) {
        if (Date.parse(s.view.expiresAt) <= Date.now()) {
          s.fundingDone = true;
          this.store.put('sessions', s.view.id, s);
          return true;
        }
        const payer = privateKeyToAccount(c.fundingKey as Hex).address;
        const q: Quote = {
          id: s.view.id,
          serviceId: 'invoice-extract',
          sampleId: 'sample-invoice-01',
          expiresAt: s.view.expiresAt,
          network,
          asset,
          payer,
          payee: s.view.walletAddress,
          price: money(c.fund),
          maxNetworkFee: money(c.maxFee),
          maxTotal: money(c.fund + c.maxFee),
          requestDigest: digest({ funding: s.view.id }),
        };
        s.fundingQuote = q;
        s.funding = await this.chain.prepare(
          c.fundingKey as Hex,
          q.payee,
          c.fund,
          binding(q),
          c.maxFee,
        );
        this.store.put('sessions', s.view.id, s);
      }
      let settled = await this.chain.settlement(s.funding.hash, s.fundingQuote!);
      if (!settled) {
        await this.chain.broadcast(s.funding.raw);
        settled = await this.chain.settlement(s.funding.hash, s.fundingQuote!);
      }
      if (!settled) return false;
      s.fundingDone = true;
      s.view.status = settled.success ? 'ready' : 'unavailable';
      s.view.balance = money(await this.chain.balance(s.view.walletAddress));
      this.store.put('sessions', s.view.id, s);
      return true;
    } catch {
      // A funding nonce remains exclusively owned until its original transaction is known.
      s.view.status = 'unavailable';
      this.store.put('sessions', s.view.id, s);
      return false;
    }
  }
  async tick() {
    if (this.working || !this.config.enabled) return;
    this.working = true;
    try {
      await this.readiness();
      if (!this.ready) return;
      for (const s of this.store.all<SessionRecord>('sessions').filter((s) => !s.fundingDone)) {
        if (!(await this.processFunding(s))) break;
      }
      for (const r of this.store
        .all<RunRecord>('runs')
        .filter((r) => !terminal.includes(r.view.status)))
        await this.processRun(r);
    } finally {
      this.working = false;
    }
  }
}
