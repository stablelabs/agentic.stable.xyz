import { describe, expect, it, vi } from 'vitest';
import { StableChain } from '../server/payments/chain';
import { asset, money, network, type Quote } from '../shared/contracts';
const hash = `0x${'ab'.repeat(32)}` as const;
const payer = `0x${'11'.repeat(20)}` as const;
const payee = `0x${'22'.repeat(20)}` as const;
const quote: Quote = {
  id: 'quote',
  serviceId: 'invoice-extract',
  sampleId: 'sample-invoice-01',
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  network,
  asset,
  payer,
  payee,
  price: money(10000n),
  maxNetworkFee: money(10000n),
  maxTotal: money(20000n),
  requestDigest: 'cd'.repeat(32),
};
function setup() {
  const chain = new StableChain('http://unused.local');
  vi.spyOn(chain, 'verifyNetwork').mockResolvedValue({
    chainId: 2201,
    nativeAsset: asset,
    erc20Decimals: 6,
    erc20Address: payee,
    explorer: network.explorerBaseUrl,
    blockNumber: '10',
    checkedAt: new Date().toISOString(),
  });
  const tx = {
    chainId: 2201,
    from: payer,
    to: payee,
    value: 10000n,
    input: `0x${quote.requestDigest}`,
  };
  const receipt = {
    transactionHash: hash,
    from: payer,
    to: payee,
    status: 'success',
    blockNumber: 10n,
    blockHash: hash,
    gasUsed: 10n,
    effectiveGasPrice: 2n,
  };
  const client = {
    getTransaction: vi.fn(async () => tx),
    getTransactionReceipt: vi.fn(async () => receipt),
    getBlockNumber: vi.fn(async () => 11n),
    getBlock: vi.fn(async () => ({ hash, timestamp: BigInt(Math.floor(Date.now() / 1000)) })),
  };
  chain.client = client as unknown as typeof chain.client;
  return { chain, tx, receipt, client };
}
describe('independent on-chain evidence validation', () => {
  it('accepts matching canonical payment and calculates actual gas', async () => {
    const { chain } = setup();
    expect(await chain.settlement(hash, quote)).toMatchObject({ success: true, fee: '20' });
  });
  for (const field of ['chainId', 'from', 'to', 'value', 'input'] as const) {
    it(`rejects incorrect ${field}`, async () => {
      const { chain, tx } = setup();
      Object.assign(tx, {
        [field]:
          field === 'chainId'
            ? 988
            : field === 'value'
              ? 9999n
              : field === 'input'
                ? '0x'
                : '0x0000000000000000000000000000000000000000',
      });
      await expect(chain.settlement(hash, quote)).rejects.toThrow('does not match');
    });
  }
  it('does not call a submitted or unconfirmed hash settled', async () => {
    const { chain, client } = setup();
    client.getBlockNumber.mockResolvedValue(10n);
    expect(await chain.settlement(hash, quote)).toBeNull();
    client.getTransactionReceipt.mockRejectedValue(
      Object.assign(new Error(), { name: 'TransactionReceiptNotFoundError' }),
    );
    expect(await chain.settlement(hash, quote)).toBeNull();
  });
  it('rejects noncanonical blocks and fees outside the signed ceiling', async () => {
    const { chain, client, receipt } = setup();
    client.getBlock.mockResolvedValue({ hash: '0xwrong' as typeof hash, timestamp: 1n });
    await expect(chain.settlement(hash, quote)).rejects.toThrow('reconciled');
    client.getBlock.mockResolvedValue({ hash, timestamp: 1n });
    receipt.gasUsed = 100000n;
    await expect(chain.settlement(hash, quote)).rejects.toThrow('reconciliation');
  });
  it('exposes actual reverted gas without claiming successful settlement', async () => {
    const { chain, receipt } = setup();
    receipt.status = 'reverted';
    expect(await chain.settlement(hash, quote)).toMatchObject({ success: false, fee: '20' });
  });
});
