import type { Page } from '@playwright/test';
import {
  asset,
  network,
  money,
  type Quote,
  type Run,
  type RunStatus,
  type Session,
} from '../../shared/contracts';
import { extractInvoice } from '../../server/seller/service';
export const fixtureSession: Session = {
  id: 'fake-session',
  mode: 'testnet',
  status: 'ready',
  expiresAt: new Date(Date.now() + 1800000).toISOString(),
  network,
  asset,
  walletAddress: 'FAKE-PAYER',
  balance: money(10n ** 18n),
  budget: {
    limit: money(5n * 10n ** 16n),
    remaining: money(5n * 10n ** 16n),
    spent: money(0n),
    reserved: money(0n),
  },
  activeRunId: null,
};
export const fixtureQuote: Quote = {
  id: 'fake-quote',
  serviceId: 'invoice-extract',
  sampleId: 'sample-invoice-01',
  expiresAt: new Date(Date.now() + 120000).toISOString(),
  network,
  asset,
  payer: 'FAKE-PAYER',
  payee: 'FAKE-PAYEE',
  price: money(10n ** 16n),
  maxNetworkFee: money(10n ** 16n),
  maxTotal: money(2n * 10n ** 16n),
  requestDigest: 'FAKE-DIGEST',
};
export function fixtureRun(status: RunStatus): Run {
  const paid = ['settled', 'delivering', 'completed', 'delivery_failed'].includes(status);
  const pending = ['queued', 'authorizing', 'submitted', 'confirming', 'payment_unknown'].includes(
    status,
  );
  const spent = paid ? 10000000000001000n : status === 'failed' ? 1000n : 0n;
  const reserved = pending ? 20000000000000000n : 0n;
  return {
    id: 'fake-run',
    purchaseId: 'fake-purchase',
    quoteId: fixtureQuote.id,
    status,
    events: [{ seq: 1, at: new Date().toISOString(), status, message: `Fixture: ${status}` }],
    txHash: ['queued', 'authorizing', 'blocked'].includes(status) ? null : 'FAKE-TRANSACTION',
    result: status === 'completed' ? extractInvoice() : null,
    receipt: paid
      ? {
          id: 'fake-receipt',
          purchaseId: 'fake-purchase',
          quoteId: fixtureQuote.id,
          network,
          asset,
          payer: 'FAKE-PAYER',
          payee: 'FAKE-PAYEE',
          pricePaid: fixtureQuote.price,
          networkFeePaid: money(1000n),
          totalPaid: money(spent),
          txHash: 'FAKE-TRANSACTION',
          explorerUrl: '',
          settledAt: new Date().toISOString(),
        }
      : null,
    session: {
      ...fixtureSession,
      activeRunId: 'fake-run',
      budget: {
        ...fixtureSession.budget,
        spent: money(spent),
        reserved: money(reserved),
        remaining: money(50000000000000000n - spent - reserved),
      },
    },
    error: ['blocked', 'failed', 'payment_unknown', 'delivery_failed'].includes(status)
      ? {
          code: status.toUpperCase(),
          message: `Fixture: ${status}`,
          retryable: ['payment_unknown', 'delivery_failed'].includes(status),
        }
      : null,
  };
}
export async function mockDemo(
  page: Page,
  options: {
    status?: RunStatus;
    funding?: boolean;
    expiredQuote?: boolean;
    failRun?: string;
    lostResponse?: boolean;
  } = {},
) {
  const stats = { runs: 0, keys: [] as string[], resumes: 0 };
  let created = false;
  await page.route('**/api/agentic/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.split('/v1')[1];
    const respond = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/capabilities')
      return respond({ environment: 'fixture', services: [{ available: true }] });
    if (path === '/session')
      return respond({
        ...fixtureSession,
        status: options.funding ? 'funding' : 'ready',
        activeRunId: created ? 'fake-run' : null,
      });
    if (path === '/quotes')
      return respond({
        ...fixtureQuote,
        expiresAt: options.expiredQuote
          ? new Date(0).toISOString()
          : new Date(Date.now() + 120000).toISOString(),
      });
    if (path === '/runs') {
      stats.runs++;
      stats.keys.push(route.request().headers()['idempotency-key']);
      if (options.failRun)
        return respond(
          { error: { code: options.failRun, message: 'Fixture rejection before payment.' } },
          409,
        );
      created = true;
      if (options.lostResponse && stats.runs === 1) return route.abort();
      return respond(fixtureRun(options.status || 'completed'), 202);
    }
    if (path.endsWith('/resume')) {
      stats.resumes++;
      return respond(
        fixtureRun(
          options.status === 'delivery_failed' ? 'completed' : options.status || 'completed',
        ),
      );
    }
    if (path.startsWith('/runs/')) return respond(fixtureRun(options.status || 'completed'));
    return respond(
      { error: { code: 'INVALID_REQUEST', message: 'Unexpected fixture request.' } },
      400,
    );
  });
  return stats;
}
