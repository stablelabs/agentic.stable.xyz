import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { parseUnits, type Hex } from 'viem';
import { z } from 'zod';
import {
  asset,
  network,
  sampleInput,
  invoiceResultSchema,
  type Quote,
  type Receipt,
} from '../../shared/contracts';
import { configFromEnv } from '../../server/config';
import { StableChain, binding, type Prepared } from '../../server/payments/chain';
import { digest } from '../../server/crypto';
import { Store } from '../../server/store';

const key = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .parse(process.env.BUYER_PRIVATE_KEY) as Hex;
const account = privateKeyToAccount(key);
const base = new URL(process.env.SELLER_URL || 'http://localhost:8788');
if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname))
  throw new Error('Remote seller must use HTTPS.');
const config = configFromEnv('buyer');
const budgetText = process.env.BUYER_BUDGET_USDT0 || '0.05';
if (!/^\d+(\.\d{1,18})?$/.test(budgetText)) throw new Error('Invalid buyer budget.');
const budget = parseUnits(budgetText, 18);
const chain = new StableChain(config.rpc);
const store = new Store(process.env.BUYER_DATABASE_PATH || './.buyer-state/buyer.sqlite');
const owner = digest({ seller: base.origin, payer: account.address });
type Purchase = {
  key: string;
  quote: Quote | null;
  prepared: Prepared | null;
  spent: string;
  status: 'pending' | 'completed' | 'reverted';
  receipt?: Receipt;
  result?: unknown;
};
let token = '';
async function request<T>(path: string, body?: unknown, requestKey?: string): Promise<T> {
  const response = await fetch(new URL(`/api/seller/v1${path}`, base), {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(requestKey ? { 'Idempotency-Key': requestKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${result.error?.code}: ${result.error?.message}`);
  return result;
}
try {
  await chain.verifyNetwork();
  const capabilities = await request<{ environment: string; available: boolean }>('/capabilities');
  if (capabilities.environment !== 'testnet' || !capabilities.available)
    throw new Error('Seller is not ready for testnet purchases.');
  const challenge = await request<{ id: string; message: string }>('/challenge', {
    address: account.address,
  });
  if (
    !challenge.message.startsWith('Stable invoice extraction\nOrigin: ') ||
    !challenge.message.includes(
      `\nAddress: ${account.address.toLowerCase()}\nNonce: ${challenge.id}\nExpires: `,
    ) ||
    !challenge.message.includes('\nChain: 2201\n')
  )
    throw new Error('Invalid seller challenge.');
  const auth = await request<{ token: string }>('/authenticate', {
    challengeId: challenge.id,
    signature: await account.signMessage({ message: challenge.message }),
  });
  token = auth.token;
  let state = store.get<Purchase>('buyer', owner);
  if (state?.status === 'pending' && process.argv.includes('--refresh-quote')) {
    if (state.prepared)
      throw new Error('A signed payment exists. Recover it without --refresh-quote.');
    state = { ...state, key: randomUUID(), quote: null };
    store.put('buyer', owner, state);
  }
  if (!state || (state.status !== 'pending' && process.argv.includes('--new'))) {
    if (!process.argv.includes('--new'))
      throw new Error(
        'No existing purchase. Use --new to authorize one quoted purchase within BUYER_BUDGET_USDT0.',
      );
    const spent = state?.spent || '0';
    state = { key: randomUUID(), quote: null, prepared: null, status: 'pending', spent };
    store.put('buyer', owner, state);
  }
  if (state.status !== 'pending') {
    console.log(
      JSON.stringify(
        { status: state.status, receipt: state.receipt, result: state.result },
        null,
        2,
      ),
    );
  } else {
    if (!state.quote) {
      const q = await request<Quote>('/quotes', sampleInput, state.key);
      const atomic = (m: Quote['price']) =>
        m && m.assetId === asset.id && /^\d+$/.test(m.amountAtomic);
      if (
        q.network.chainId !== network.chainId ||
        JSON.stringify(q.asset) !== JSON.stringify(asset) ||
        q.payer.toLowerCase() !== account.address.toLowerCase() ||
        q.payee.toLowerCase() !== config.payee.toLowerCase() ||
        q.serviceId !== sampleInput.serviceId ||
        q.sampleId !== sampleInput.sampleId ||
        !atomic(q.price) ||
        !atomic(q.maxNetworkFee) ||
        !atomic(q.maxTotal) ||
        BigInt(q.maxTotal.amountAtomic) !==
          BigInt(q.price.amountAtomic) + BigInt(q.maxNetworkFee.amountAtomic)
      )
        throw new Error('Seller quote has invalid terms or does not match SELLER_ADDRESS.');
      const { requestDigest, ...terms } = q;
      if (digest(terms) !== requestDigest) throw new Error('Quote digest does not match.');
      state.quote = q;
      store.put('buyer', owner, state);
    }
    const q = state.quote;
    if (!state.prepared) {
      if (Date.parse(q.expiresAt) <= Date.now())
        throw new Error(
          'Quote expired before signing. No payment sent. Clear this unsigned intent using the documented recovery procedure before authorizing a new quote.',
        );
      if (BigInt(state.spent) + BigInt(q.maxTotal.amountAtomic) > budget)
        throw new Error('BUDGET_EXCEEDED: maximum total exceeds the remaining operator budget.');
      state.prepared = await chain.prepare(
        key,
        q.payee,
        BigInt(q.price.amountAtomic),
        binding(q),
        BigInt(q.maxNetworkFee.amountAtomic),
      );
      // The exact signature is durable before the first possible broadcast.
      store.put('buyer', owner, state);
    }
    let settlement = await chain.settlement(state.prepared.hash, q);
    if (!settlement) await chain.broadcast(state.prepared.raw);
    for (let attempt = 0; !settlement && attempt < 30; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      settlement = await chain.settlement(state.prepared.hash, q);
    }
    if (!settlement)
      throw new Error('PAYMENT_UNKNOWN: rerun npm run buyer to recover this same signed payment.');
    if (!settlement.success) {
      state.spent = String(BigInt(state.spent) + BigInt(settlement.fee));
      state.status = 'reverted';
      store.put('buyer', owner, state);
      throw new Error('PAYMENT_REVERTED: actual network fee was recorded in the local budget.');
    }
    const delivered = await request<{ receipt: Receipt; result: unknown }>(
      `/orders/${q.id}/redeem`,
      { txHash: state.prepared.hash },
    );
    const result = invoiceResultSchema.parse(delivered.result);
    if (
      delivered.receipt.txHash !== state.prepared.hash ||
      delivered.receipt.quoteId !== q.id ||
      delivered.receipt.pricePaid.amountAtomic !== q.price.amountAtomic ||
      delivered.receipt.networkFeePaid.amountAtomic !== settlement.fee
    )
      throw new Error('Receipt does not match independently verified settlement.');
    state.spent = String(
      BigInt(state.spent) + BigInt(q.price.amountAtomic) + BigInt(settlement.fee),
    );
    state.status = 'completed';
    state.receipt = delivered.receipt;
    state.result = result;
    store.put('buyer', owner, state);
    console.log(
      JSON.stringify(
        {
          result,
          receipt: delivered.receipt,
          remainingBudgetAtomic: String(budget - BigInt(state.spent)),
        },
        null,
        2,
      ),
    );
  }
} finally {
  store.close();
}
