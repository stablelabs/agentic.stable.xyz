import Database from 'better-sqlite3';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Ledger, type SqlValue } from './ledger';

export class Store extends Ledger {
  private sqlite: Database.Database;
  private ownership?: Database.Database;
  constructor(path: string) {
    let ownership: Database.Database | undefined;
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      // The OS releases this signer ownership lock on process exit or crash.
      ownership = new Database(`${path}.owner-lock`, { timeout: 0 });
      try {
        ownership.exec('BEGIN EXCLUSIVE');
      } catch {
        ownership.close();
        throw new Error('Another process owns this database. Use one process per local database.');
      }
    }
    const db = new Database(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    db.pragma('busy_timeout = 5000');
    super({ exec: (query) => db.exec(query), prepare: (query) => db.prepare<SqlValue[]>(query) });
    this.sqlite = db;
    this.ownership = ownership;
  }
  atomic<T>(fn: () => T): T {
    return this.sqlite.transaction(fn).immediate();
  }
  async flush() {
    // synchronous=FULL commits are durable before returning from SQLite.
  }
  close() {
    this.sqlite.close();
    this.ownership?.close();
  }
}
