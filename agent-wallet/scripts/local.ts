import { chmod, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import { BaseError, InsufficientFundsError, createWalletClient, formatUnits, http, keccak256, type Hex, type TransactionRequest } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { chain, validateConfig, type WalletConfig } from '../client/config';
import { trackTransaction, type PublicClient, type ReceiptCheck } from '../client/client';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const stateDir = resolve(root, process.env.WALLET_STATE_DIR || '.agent-wallet');
export const configPath = resolve(stateDir, 'config.json');
export const aliceEnvPath = resolve(root, process.env.WALLET_ALICE_ENV || 'agent-wallet/.env.alice.local');
export const newId = (): Hex => `0x${randomBytes(32).toString('hex')}`;
export function args(names: string[]) {
  return parseArgs({ options: Object.fromEntries(names.map(name => [name, { type: 'string' as const }])), strict: true }).values as Record<string, string | undefined>;
}
export function required(value: string | undefined, label: string): string {
  if (!value) throw new Error(`Missing --${label}.`);
  return value;
}
export async function secureDir() {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const info = await lstat(stateDir);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077)) throw new Error(`State directory must be private (chmod 700): ${stateDir}`);
}
export async function readJson<T>(path: string): Promise<T> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077)) throw new Error(`Local state must be a private regular file (chmod 600): ${path}`);
  return JSON.parse(await readFile(path, 'utf8'));
}
export async function exists(path: string) {
  try { await lstat(path); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; }
}
export async function saveJson(path: string, value: unknown) {
  const temp = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  const file = await open(temp, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync(); } finally { await file.close(); }
  await rename(temp, path);
  const dir = await open(dirname(path), 'r');
  try { await dir.sync(); } finally { await dir.close(); }
}
export async function loadConfig(): Promise<WalletConfig> { return validateConfig(await readJson(configPath)); }
export async function publishConfig(config: WalletConfig) {
  const path = resolve(root, process.env.WALLET_PUBLIC_CONFIG_PATH || 'agent-wallet/app/public/wallet-config.json');
  await saveJson(path, validateConfig(config));
  await chmod(path, 0o644); // Explicit allowlist of public metadata only; never copy environment or key files.
}
export function keyAccount(key: unknown): PrivateKeyAccount {
  if (typeof key !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('Private key must be 0x followed by 64 hex digits.');
  try { return privateKeyToAccount(key as Hex); } catch { throw new Error('Invalid private key.'); }
}
export async function agentAccount() {
  const record = await readJson<{ privateKey: Hex; address: string }>(resolve(stateDir, 'agent-key.json'));
  const account = keyAccount(record.privateKey);
  if (account.address !== record.address) throw new Error('Agent key record is corrupt.');
  return account;
}
export const signer = (account: PrivateKeyAccount, rpcUrl: string) => createWalletClient({ account, chain, transport: http(rpcUrl) });

export type Journal = {
  kind: string; intent: Record<string, string>; id?: Hex; raw?: Hex; hash?: Hex; confirmedHash?: Hex;
  status: 'created' | 'signed' | 'submitted' | 'confirmed' | 'reverted' | 'rejected';
  block?: string; feeAtomic?: string;
};
// A timeout is unknown, never a rejection. Reuse this journal and identical signed bytes.
export async function submit(client: PublicClient, account: PrivateKeyAccount, path: string, journal: Journal, request: TransactionRequest, check?: ReceiptCheck) {
  if (!journal.raw) {
    const wallet = signer(account, client.transport.url!);
    const balance = await client.getBalance({ address: account.address });
    const fundingError = () => new Error(`Gas payer ${account.address} has ${formatUnits(balance, 18)} native USDT0 on Stable Testnet. Fund this signer to cover gas${request.value ? ' and the transfer value' : ''}, then retry the same saved ID. Agent-signed transactions use the agent's balance, separately from Alice's balance.`);
    if (balance === 0n || balance < (request.value ?? 0n)) throw fundingError();
    const prepared = await wallet.prepareTransactionRequest({ ...request, account, chain, maxPriorityFeePerGas: 0n } as never).catch(error => {
      if (error instanceof BaseError && error.walk(cause => cause instanceof InsufficientFundsError) instanceof InsufficientFundsError) throw fundingError();
      throw error;
    });
    const raw = await wallet.signTransaction(prepared as never);
    journal.raw = raw; journal.hash = keccak256(raw); journal.status = 'signed';
    await saveJson(path, journal);
  }
  const hash = journal.hash!;
  try {
    const receipt = await client.getTransactionReceipt({ hash: journal.confirmedHash ?? hash });
    if (receipt) return await finish();
  } catch (e) { if ((e as Error).name !== 'TransactionReceiptNotFoundError') throw e; }
  try { await client.sendRawTransaction({ serializedTransaction: journal.raw }); }
  catch {
    // A transport failure may have happened after acceptance. Keep signed state recoverable.
    try { await client.getTransaction({ hash }); }
    catch { throw new Error(`Submission outcome unknown. Retry the same command and ID. Transaction: ${hash}`); }
  }
  journal.status = 'submitted'; await saveJson(path, journal);
  return await finish();
  async function finish() {
    const result = await trackTransaction(client, journal.confirmedHash ?? hash, check);
    journal.confirmedHash = result.hash;
    journal.status = result.success ? 'confirmed' : 'reverted'; journal.block = result.block; journal.feeAtomic = result.feeAtomic;
    await saveJson(path, journal);
    console.log(JSON.stringify({ ...result, status: journal.status, explorer: `${chain.blockExplorers.default.url}/tx/${result.hash}` }, null, 2));
    if (!result.success) throw new Error('Transaction reverted onchain. No payment or spending update was committed; network fees may apply.');
    return result;
  }
}
export async function run(fn: () => Promise<void>) {
  process.umask(0o077);
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  const lockPath = resolve(stateDir, 'command.lock');
  try {
    await secureDir();
    try { lock = await open(lockPath, 'wx', 0o600); await lock.writeFile(String(process.pid)); }
    catch { throw new Error(`Another wallet command is running. If it crashed, verify its process has stopped before removing ${lockPath}.`); }
    await fn();
  } catch (e) {
    // Avoid verbose RPC errors containing signed transactions or local signer data.
    console.error(e instanceof Error ? ('shortMessage' in e ? String(e.shortMessage) : e.message) : 'Wallet command failed.');
    process.exitCode = 1;
  } finally { if (lock) { await lock.close(); await unlink(lockPath); } }
}
