import { lstat, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WalletError } from 'agent-wallet-sdk/protocol';

export const newId = () => `0x${randomBytes(32).toString('hex')}` as const;
export async function exists(path: string) {
  try { await lstat(path); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; }
}
export async function secureDir(path: string, create = true) {
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077)) throw new WalletError('UNSAFE_STATE', `State directory must be private (chmod 700): ${path}`);
}
export async function readJson<T>(path: string): Promise<T> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077)) throw new WalletError('UNSAFE_STATE', `Local state must be a private regular file (chmod 600): ${path}`);
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { throw new WalletError('INVALID_STATE', `Invalid JSON in ${path}. Retain this file for recovery.`); }
}
export async function saveJson(path: string, value: unknown, publicMetadata = false) {
  if (await exists(path)) {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || (!publicMetadata && (info.mode & 0o077))) throw new WalletError('UNSAFE_STATE', `Refusing to replace unsafe local state: ${path}`);
  }
  const temp = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  const file = await open(temp, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync(); } finally { await file.close(); }
  await rename(temp, path);
  const dir = await open(dirname(path), 'r');
  try { await dir.sync(); } finally { await dir.close(); }
}
export class StateStore {
  readonly directory: string;
  constructor(directory: string) { this.directory = resolve(directory); }
  path(name: string) {
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new WalletError('INVALID_INPUT', 'Invalid state filename.', 2);
    return resolve(this.directory, name);
  }
  async read<T>(name: string) { await secureDir(this.directory, false); return readJson<T>(this.path(name)); }
  async has(name: string) { return exists(this.path(name)); }
  async write(name: string, value: unknown) { await secureDir(this.directory, false); await saveJson(this.path(name), value); }
  async files(prefix: string) {
    if (!await exists(this.directory)) return [];
    await secureDir(this.directory, false);
    return (await readdir(this.directory)).filter(name => name.startsWith(prefix) && name.endsWith('.json')).sort();
  }
  async lock<T>(fn: () => Promise<T>) {
    await secureDir(this.directory);
    const path = this.path('command.lock');
    let lock;
    try { lock = await open(path, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new WalletError('STATE_LOCKED', `Another wallet command holds ${path}. Verify its process stopped before removing a stale lock.`, 8);
      throw error;
    }
    try { await lock.writeFile(String(process.pid)); return await fn(); }
    finally { await lock.close(); await unlink(path); }
  }
}
