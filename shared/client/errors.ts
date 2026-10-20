export class WalletError extends Error {
  constructor(public code: string, message: string, public exitCode = 3, public data?: unknown) {
    super(message);
    this.name = 'WalletError';
  }
}

export function input<T>(fn: () => T): T {
  try { return fn(); } catch (error) {
    if (error instanceof WalletError) throw error;
    throw new WalletError('INVALID_INPUT', error instanceof Error ? error.message : 'Invalid input.', 2);
  }
}

export function duration(value: string, label = 'duration'): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value);
  if (!match) throw new WalletError('INVALID_INPUT', `Use a positive ${label} such as 120s or 24h.`, 2);
  const ms = Number(match[1]) * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]]!);
  if (!Number.isSafeInteger(ms) || ms <= 0 || ms > 2_147_483_647) throw new WalletError('INVALID_INPUT', `${label} is out of range.`, 2);
  return ms;
}
