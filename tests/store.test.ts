import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Store } from '../server/store';
describe('database ownership and durability', () => {
  it('excludes concurrent signers and preserves records after restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentic-store-'));
    const file = join(dir, 'test.sqlite');
    const first = new Store(file);
    first.put('test', 'id', { reservation: '20000000000000000' });
    expect(() => new Store(file)).toThrow('Another process');
    first.close();
    const restarted = new Store(file);
    expect(restarted.get('test', 'id')).toEqual({ reservation: '20000000000000000' });
    restarted.close();
    rmSync(dir, { recursive: true });
  });
});
