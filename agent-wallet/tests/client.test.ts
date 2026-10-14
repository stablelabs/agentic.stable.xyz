import { describe, expect, it } from 'vitest';
import { parseAmount, formatAmount } from '../client/amount';
import { CHAIN_ID, TOKEN, validateConfig, identifier } from '../client/config';
import { grantStatus, paymentCheck, trackTransaction, type PublicClient } from '../client/client';
import { parseGrantDraft } from '../client/grant-input';

describe('exact amount parsing', () => {
  it('preserves all six decimals without floating point or rounding', () => {
    expect(parseAmount('0.01')).toBe(10000n);
    expect(parseAmount('0.006')).toBe(6000n);
    expect(parseAmount('9007199254740993.000001')).toBe(9007199254740993000001n);
    expect(formatAmount(6000n)).toBe('0.006');
  });
  it.each(['0', '-1', '+1', '.006', '1.', '01', '1e-3', '0.0000001', '0.0060001', 'NaN', ' 1 ', '1,000', '1'.repeat(80)])('rejects unsafe amount %s', input => {
    expect(() => parseAmount(input)).toThrow();
  });
});
it('never accepts mainnet or a different token', () => {
  const config = { chainId: CHAIN_ID, token: TOKEN, alice: '0x0000000000000000000000000000000000000001', implementation: '0x0000000000000000000000000000000000000002', implementationCodeHash: `0x${'11'.repeat(32)}`, rpcUrl: 'http://localhost:18545', approvalUrl: 'http://localhost:5174' };
  expect(validateConfig(config)).toEqual(config);
  expect(validateConfig({ ...config, privateKey: 'must-stay-local' })).not.toHaveProperty('privateKey');
  expect(() => validateConfig({ ...config, chainId: 988 })).toThrow();
  expect(() => validateConfig({ ...config, token: config.alice })).toThrow();
  expect(() => identifier(`0x${'00'.repeat(32)}`)).toThrow();
  expect(identifier(`0x${'AA'.repeat(32)}`)).toBe(`0x${'aa'.repeat(32)}`);
});
it('derives expiry and exhaustion without changing terminal states', () => {
  const g = { agent: TOKEN, recipient: TOKEN, budget: 10000n, spent: 6000n, expiresAt: 2000n, status: 2 };
  expect(grantStatus(g, 1999n)).toBe('Active');
  expect(grantStatus(g, 2000n)).toBe('Expired');
  expect(grantStatus({ ...g, spent: 10000n }, 1000n)).toBe('Exhausted');
  expect(grantStatus({ ...g, status: 3 }, 2000n)).toBe('Rejected');
  expect(grantStatus({ ...g, status: 4 }, 2000n)).toBe('Revoked');
});
it.each(['cancelled', 'replaced'])('never confirms a %s transaction as the requested action', async reason => {
  const client = { waitForTransactionReceipt: async (options: any) => {
    options.onReplaced({ reason });
    return { transactionHash: `0x${'22'.repeat(32)}`, status: 'success', blockNumber: 1n, gasUsed: 1n, effectiveGasPrice: 1n };
  } } as unknown as PublicClient;
  await expect(trackTransaction(client, `0x${'11'.repeat(32)}`)).rejects.toThrow('cancelled or replaced');
});
it('rejects a successful no-op receipt without the exact Payment event', async () => {
  const hash = `0x${'11'.repeat(32)}` as const;
  const client = { waitForTransactionReceipt: async () => ({ transactionHash: hash, status: 'success', blockNumber: 1n, gasUsed: 1n, effectiveGasPrice: 1n, logs: [] }) } as unknown as PublicClient;
  await expect(trackTransaction(client, hash, paymentCheck(TOKEN, hash, hash, TOKEN, 6000n))).rejects.toThrow('no matching Payment');
});
it('tracks repricing of the same action by its confirmed hash', async () => {
  const replacement = `0x${'22'.repeat(32)}` as const;
  const client = { waitForTransactionReceipt: async (options: any) => {
    options.onReplaced({ reason: 'repriced' });
    return { transactionHash: replacement, status: 'success', blockNumber: 1n, gasUsed: 1n, effectiveGasPrice: 1n };
  } } as unknown as PublicClient;
  expect((await trackTransaction(client, `0x${'11'.repeat(32)}`)).hash).toBe(replacement);
});
it('validates exact owner-created grant terms, including UTC expiry and separate agent identity', () => {
  const draft = { id: `0x${'11'.repeat(32)}` as const, agent: '0x2222222222222222222222222222222222222222', recipient: '0x3333333333333333333333333333333333333333', budget: '0.01', expires: '2030-01-01T00:00:00Z' };
  const alice = '0x1111111111111111111111111111111111111111';
  expect(parseGrantDraft(draft, alice, 1000n).budget).toBe(10000n);
  expect(() => parseGrantDraft({ ...draft, agent: alice }, alice, 1000n)).toThrow('separate');
  expect(() => parseGrantDraft({ ...draft, budget: '0.0000001' }, alice, 1000n)).toThrow();
  expect(() => parseGrantDraft({ ...draft, expires: '2030-02-30T00:00:00Z' }, alice, 1000n)).toThrow('Invalid expiry');
  expect(() => parseGrantDraft(draft, alice, 1893456000n)).toThrow('future');
});
