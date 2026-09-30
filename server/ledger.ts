import { AppError } from './errors';

export type SqlValue = string | number | bigint | null;
export interface SqlDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): {
    get(...values: SqlValue[]): unknown;
    all(...values: SqlValue[]): unknown[];
    run(...values: SqlValue[]): unknown;
  };
}

// Shared SQL and invariants; each runtime supplies transactions and durability.
export abstract class Ledger {
  constructor(public db: SqlDatabase) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS idempotency (owner TEXT NOT NULL, route TEXT NOT NULL, key TEXT NOT NULL, digest TEXT NOT NULL, result TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(owner,route,key));
      CREATE TABLE IF NOT EXISTS payments (hash TEXT PRIMARY KEY, order_id TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS active_runs (session_id TEXT PRIMARY KEY, run_id TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS accepted_quotes (quote_id TEXT PRIMARY KEY, run_id TEXT UNIQUE NOT NULL);
    `);
  }
  abstract atomic<T>(fn: () => T): T;
  abstract flush(): Promise<void>;
  get<T>(kind: string, id: string): T | undefined {
    const row = this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind, id) as
      | { data: string }
      | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  put(kind: string, id: string, data: unknown) {
    this.db
      .prepare(
        'INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data',
      )
      .run(kind, id, JSON.stringify(data));
  }
  all<T>(kind: string): T[] {
    return (
      this.db.prepare('SELECT data FROM records WHERE kind=?').all(kind) as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  }
  once<T>(owner: string, route: string, key: string, digest: string, fn: () => T): T {
    return this.atomic(() => {
      const old = this.db
        .prepare('SELECT digest,result FROM idempotency WHERE owner=? AND route=? AND key=?')
        .get(owner, route, key) as { digest: string; result: string } | undefined;
      if (old) {
        if (old.digest !== digest)
          throw new AppError(
            'IDEMPOTENCY_CONFLICT',
            'This request key already has different terms.',
          );
        return JSON.parse(old.result);
      }
      const result = fn();
      this.db
        .prepare('INSERT INTO idempotency VALUES(?,?,?,?,?,?)')
        .run(owner, route, key, digest, JSON.stringify(result), Date.now());
      return result;
    });
  }
  rate(key: string, limit: number, window = 3_600_000) {
    this.atomic(() => {
      const row = this.db.prepare('SELECT count,reset FROM rate_limits WHERE key=?').get(key) as
        | { count: number; reset: number }
        | undefined;
      if (row && row.reset > Date.now() && row.count >= limit)
        throw new AppError(
          'RATE_LIMITED',
          'Please wait before trying again.',
          429,
          true,
          Math.ceil((row.reset - Date.now()) / 1000),
        );
      this.db
        .prepare('INSERT OR REPLACE INTO rate_limits VALUES(?,?,?)')
        .run(
          key,
          row && row.reset > Date.now() ? row.count + 1 : 1,
          row && row.reset > Date.now() ? row.reset : Date.now() + window,
        );
    });
  }
  consume(hash: string, orderId: string) {
    const row = this.db.prepare('SELECT order_id FROM payments WHERE hash=?').get(hash) as
      | { order_id: string }
      | undefined;
    if (row?.order_id === orderId) return;
    if (row) throw new AppError('INVALID_PAYMENT', 'This payment belongs to another order.');
    this.db.prepare('INSERT INTO payments VALUES(?,?)').run(hash, orderId);
  }
}
