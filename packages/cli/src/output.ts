import { BaseError } from 'viem';
import { WalletError } from 'agent-wallet-sdk/protocol';

export const json = (value: unknown) => JSON.stringify(value, (_, v: unknown) => typeof v === 'bigint' ? v.toString() : v, 2);
export function publicError(error: unknown) {
  if (error instanceof WalletError) return error;
  if (error instanceof BaseError) return new WalletError('RPC_UNAVAILABLE', 'RPC request failed. Retry a status check; preserve saved payment IDs.', 5);
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return new WalletError('STATE_REQUIRED', 'Required local state is missing. Run init and import public configuration.');
  return new WalletError('COMMAND_FAILED', 'Wallet command failed. Retain local state for inspection.');
}
export function render(command: string, data: unknown, asJson: boolean, error?: WalletError) {
  const result = {
    schemaVersion: 1, ok: !error, command,
    ...(error ? { error: { code: error.code, message: error.message } } : {}),
    data: error ? error.data ?? null : data,
    ...(error?.exitCode === 6 ? { recovery: { action: command.startsWith('grants') ? 'grants wait' : 'payments wait', ...(error.data && typeof error.data === 'object' && 'paymentId' in error.data ? { paymentId: error.data.paymentId } : {}) } } : {}),
  };
  if (asJson) process.stdout.write(json(result) + '\n');
  else if (error) process.stderr.write(`${error.code}: ${error.message}\n${error.data ? json(error.data) + '\n' : ''}`);
  else if (data && typeof data === 'object' && 'paymentId' in data && 'intent' in data && 'status' in data) {
    const payment = data as { paymentId: string; status: string; amount: string; intent: Record<string, string>; explorer?: string };
    process.stdout.write(`Payment ${payment.status}\n  Payment ID      ${payment.paymentId}\n  Grant ID        ${payment.intent.grantId}\n  Amount          ${payment.amount} USDT0\n  Payment source  Alice: ${payment.intent.alice}\n  Gas payer       Agent: ${payment.intent.agent}\n${payment.explorer ? `  Transaction     ${payment.explorer}\n` : ''}`);
  } else process.stdout.write(typeof data === 'string' ? data + '\n' : json(data) + '\n');
}
