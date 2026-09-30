import { randomUUID } from 'node:crypto';
import type { Hex } from 'viem';
import {
  asset,
  money,
  network,
  type InvoiceResult,
  type Quote,
  type Receipt,
} from '../../shared/contracts';
import { digest } from '../crypto';
import { AppError, requireThat } from '../errors';
import type { Config } from '../config';
import type { Ledger } from '../ledger';
import type { PaymentChain } from '../payments/chain';
import { extractInvoice } from './service';

export type Order = {
  id: string;
  owner: string;
  quote: Quote;
  receipt: Receipt | null;
  result: InvoiceResult | null;
};
export class Seller {
  constructor(
    public store: Ledger,
    public chain: PaymentChain,
    public config: Config,
  ) {}
  quote(owner: string, payer: string): Quote {
    const c = this.config;
    const terms = {
      id: randomUUID(),
      serviceId: 'invoice-extract',
      sampleId: 'sample-invoice-01',
      expiresAt: new Date(Date.now() + c.quoteMs).toISOString(),
      network,
      asset,
      payer,
      payee: c.payee,
      price: money(c.price),
      maxNetworkFee: money(c.maxFee),
      maxTotal: money(c.price + c.maxFee),
    } as const;
    const quote = { ...terms, requestDigest: digest(terms) };
    this.store.put('orders', quote.id, {
      id: quote.id,
      owner,
      quote,
      receipt: null,
      result: null,
    } satisfies Order);
    return quote;
  }
  order(id: string, owner: string) {
    const order = this.store.get<Order>('orders', id);
    requireThat(order && order.owner === owner, 'NOT_FOUND', 'Purchase not found.', 404);
    return order;
  }
  async verify(id: string, owner: string, hash: Hex) {
    const order = this.order(id, owner);
    if (order.receipt) {
      requireThat(
        order.receipt.txHash === hash,
        'INVALID_PAYMENT',
        'Purchase already has different payment evidence.',
      );
      return order.receipt;
    }
    const settled = await this.chain.settlement(hash, order.quote);
    if (!settled) throw new AppError('PAYMENT_UNKNOWN', 'Checking payment status.', 409, true);
    if (!settled.success)
      throw new AppError('PAYMENT_REVERTED', 'Payment reverted. No service price was charged.');
    const q = order.quote;
    const receipt: Receipt = {
      id: randomUUID(),
      purchaseId: order.id,
      quoteId: q.id,
      network,
      asset,
      payer: q.payer,
      payee: q.payee,
      pricePaid: q.price,
      networkFeePaid: money(settled.fee),
      totalPaid: money(BigInt(q.price.amountAtomic) + BigInt(settled.fee)),
      txHash: hash,
      explorerUrl: `${network.explorerBaseUrl}/tx/${hash}`,
      settledAt: settled.timestamp,
    };
    return this.store.atomic(() => {
      const current = this.order(id, owner);
      if (current.receipt) {
        requireThat(current.receipt.txHash === hash, 'INVALID_PAYMENT', 'Purchase already paid.');
        return current.receipt;
      }
      this.store.consume(hash, id);
      current.receipt = receipt;
      this.store.put('orders', id, current);
      return receipt;
    });
  }
  deliver(id: string, owner: string) {
    return this.store.atomic(() => {
      const order = this.order(id, owner);
      requireThat(order.receipt, 'PAYMENT_REQUIRED', 'Verified payment is required.', 402);
      if (!order.result) {
        order.result = extractInvoice();
        this.store.put('orders', id, order);
      }
      return { receipt: order.receipt, result: order.result };
    });
  }
}
