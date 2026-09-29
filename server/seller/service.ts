import { invoiceResultSchema, sampleSource, type InvoiceResult } from '../../shared/contracts';
export function extractInvoice(source = sampleSource): InvoiceResult {
  const fields = Object.fromEntries(
    source.split('\n').map((line) => {
      const at = line.indexOf(':');
      return [line.slice(0, at), line.slice(at + 1).trim()];
    }),
  );
  const [description, quantity, unitPrice, total] = fields.Item.split('|').map((s) => s.trim());
  const cents = (s: string) => {
    if (!/^\d+\.\d{2}$/.test(s)) throw new Error('Invalid invoice amount');
    return BigInt(s.replace('.', ''));
  };
  if (
    !/^\d+$/.test(quantity) ||
    cents(unitPrice) * BigInt(quantity) !== cents(total) ||
    cents(total) !== cents(fields.Total)
  )
    throw new Error('Invoice totals do not reconcile');
  return invoiceResultSchema.parse({
    type: 'invoice-extraction',
    sampleId: 'sample-invoice-01',
    vendor: fields.Vendor,
    invoiceNumber: fields.Invoice,
    currency: fields.Currency,
    lineItems: [{ description, quantity, unitPrice, total }],
    total: fields.Total,
  });
}
