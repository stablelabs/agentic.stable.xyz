import 'dotenv/config';
import { parseUnits, isAddress, zeroAddress } from 'viem';
export function configFromEnv(role: 'site' | 'seller' | 'buyer' = 'site') {
  const amount = (key: string, fallback: string) => {
    const value = process.env[key] || fallback;
    if (!/^\d+(\.\d{1,18})?$/.test(value)) throw new Error(`Invalid ${key}`);
    return parseUnits(value, 18);
  };
  const enabled = process.env.PAYMENTS_ENABLED === 'true';
  const encryptionKey = process.env.SESSION_ENCRYPTION_KEY || '';
  const fundingKey = process.env.FUNDING_PRIVATE_KEY || '';
  const payee = process.env.SELLER_ADDRESS || '';
  if (
    enabled &&
    role === 'site' &&
    (!/^[a-fA-F0-9]{64}$/.test(encryptionKey) ||
      !/^0x[a-fA-F0-9]{64}$/.test(fundingKey) ||
      !isAddress(payee) ||
      payee === zeroAddress)
  ) {
    throw new Error(
      'Live payments require SESSION_ENCRYPTION_KEY, FUNDING_PRIVATE_KEY and a nonzero SELLER_ADDRESS.',
    );
  }
  if (enabled && role === 'seller' && (!isAddress(payee) || payee === zeroAddress))
    throw new Error('Seller requires a nonzero testnet SELLER_ADDRESS.');
  const origin = process.env.PUBLIC_ORIGIN || 'http://localhost:5173';
  if (new URL(origin).origin !== origin)
    throw new Error('PUBLIC_ORIGIN must be an origin without a path or trailing slash.');
  const sessionRate = Number(process.env.SESSION_RATE_PER_HOUR || 3);
  if (!Number.isSafeInteger(sessionRate) || sessionRate < 1)
    throw new Error('SESSION_RATE_PER_HOUR must be a positive integer.');
  const repository = process.env.REPOSITORY_URL || '';
  if (repository) {
    const url = new URL(repository);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.pathname.split('/').filter(Boolean).length !== 2) {
      throw new Error('REPOSITORY_URL must identify an HTTPS GitHub repository.');
    }
  }
  if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://'))
    throw new Error('Production requires HTTPS PUBLIC_ORIGIN.');
  return {
    enabled,
    encryptionKey,
    fundingKey,
    payee,
    origin,
    rpc: process.env.STABLE_RPC_URL || 'https://rpc.testnet.stable.xyz',
    database: process.env.DATABASE_PATH || './data/site.sqlite',
    price: amount('PRICE_USDT0', '0.01'),
    maxFee: amount('MAX_FEE_USDT0', '0.01'),
    fund: amount('SESSION_FUND_USDT0', '1'),
    budget: amount('SESSION_BUDGET_USDT0', '0.05'),
    fundingCap: amount('GLOBAL_FUNDING_CAP_USDT0', '10'),
    sessionRate,
    repository,
    sessionMs: 30 * 60_000,
    quoteMs: 120_000,
  };
}
export type Config = ReturnType<typeof configFromEnv>;
