import { z } from 'zod';
export const contractVersion = 'site-demo/v1';
export const asset = {
  id: 'stable-testnet:native',
  symbol: 'USDT0',
  kind: 'native',
  address: null,
  decimals: 18,
} as const;
export const network = {
  name: 'Stable Testnet',
  chainId: 2201,
  explorerBaseUrl: 'https://testnet.stablescan.xyz',
} as const;
export type Money = { assetId: string; amountAtomic: string };
export const money = (n: bigint | string): Money => ({
  assetId: asset.id,
  amountAtomic: String(n),
});
export function formatMoney(value: Money, decimals: number = asset.decimals): string {
  const n = BigInt(value.amountAtomic);
  const base = 10n ** BigInt(decimals);
  const fractional = (n % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${n / base}${fractional ? '.' + fractional : ''}`;
}
export type Session = {
  id: string;
  mode: 'testnet';
  status: 'funding' | 'ready' | 'unavailable' | 'expired';
  expiresAt: string;
  network: typeof network;
  asset: typeof asset;
  walletAddress: string;
  balance: Money;
  budget: { limit: Money; spent: Money; reserved: Money; remaining: Money };
  activeRunId: string | null;
};
export type Quote = {
  id: string;
  serviceId: 'invoice-extract';
  sampleId: 'sample-invoice-01';
  expiresAt: string;
  network: typeof network;
  asset: typeof asset;
  payer: string;
  payee: string;
  price: Money;
  maxNetworkFee: Money;
  maxTotal: Money;
  requestDigest: string;
};
export const statuses = [
  'queued',
  'authorizing',
  'submitted',
  'confirming',
  'settled',
  'delivering',
  'completed',
  'blocked',
  'failed',
  'payment_unknown',
  'delivery_failed',
] as const;
export type RunStatus = (typeof statuses)[number];
export type RunEvent = { seq: number; at: string; status: RunStatus; message: string };
export type Receipt = {
  id: string;
  purchaseId: string;
  quoteId: string;
  network: typeof network;
  asset: typeof asset;
  payer: string;
  payee: string;
  pricePaid: Money;
  networkFeePaid: Money;
  totalPaid: Money;
  txHash: string;
  explorerUrl: string;
  settledAt: string;
};
export const invoiceResultSchema = z.object({
  type: z.literal('invoice-extraction'),
  sampleId: z.literal('sample-invoice-01'),
  vendor: z.string(),
  invoiceNumber: z.string(),
  currency: z.literal('USD'),
  lineItems: z
    .array(
      z.object({
        description: z.string(),
        quantity: z.string(),
        unitPrice: z.string(),
        total: z.string(),
      }),
    )
    .min(1),
  total: z.string(),
});
export type InvoiceResult = z.infer<typeof invoiceResultSchema>;
export type DomainError = { code: string; message: string; retryable: boolean };
export type Run = {
  id: string;
  purchaseId: string;
  quoteId: string;
  status: RunStatus;
  events: RunEvent[];
  txHash: string | null;
  receipt: Receipt | null;
  result: InvoiceResult | null;
  session: Session;
  error: DomainError | null;
};
export const inputSchema = z
  .object({ serviceId: z.literal('invoice-extract'), sampleId: z.literal('sample-invoice-01') })
  .strict();
export { sampleSource } from './sample';
export const sampleInput = { serviceId: 'invoice-extract', sampleId: 'sample-invoice-01' } as const;
