import { Ledger, type SqlValue } from '../server/ledger';

export class DurableLedger extends Ledger {
  constructor(private storage: DurableObjectStorage) {
    const exec = (query: string, values: SqlValue[]) =>
      storage.sql.exec(query, ...values.map((v) => (typeof v === 'bigint' ? String(v) : v)));
    super({
      exec: (query) => storage.sql.exec(query),
      prepare: (query) => ({
        get: (...values) => exec(query, values).toArray()[0],
        all: (...values) => exec(query, values).toArray(),
        run: (...values) => exec(query, values).toArray(),
      }),
    });
  }
  atomic<T>(fn: () => T): T {
    return this.storage.transactionSync(fn);
  }
  flush() {
    return this.storage.sync();
  }
}
