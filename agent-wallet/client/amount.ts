import { formatUnits, parseUnits } from 'viem';
import { DECIMALS } from './config';

export function parseAmount(text: string): bigint {
  // viem's parseUnits rounds extra digits: reject them before calling it.
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(text)) throw new Error('Use a positive decimal amount with at most 6 fractional digits.');
  const amount = parseUnits(text, DECIMALS);
  if (amount <= 0n || amount >= 2n ** 256n) throw new Error('Amount is outside uint256 range.');
  return amount;
}
export const formatAmount = (amount: bigint) => formatUnits(amount, DECIMALS);
