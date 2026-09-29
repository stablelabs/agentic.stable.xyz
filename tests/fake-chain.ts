import { keccak256, stringToHex, type Hex } from 'viem';
import type { Quote } from '../shared/contracts';
import type { PaymentChain, Prepared, Settlement } from '../server/payments/chain';
export class FakeChain implements PaymentChain {
  prepared: Prepared[] = [];
  broadcasts: Hex[] = [];
  transactions = new Map<Hex, { to: string; amount: bigint; data: Hex }>();
  pending = false;
  revert = false;
  lostResponse = false;
  offline = false;
  delivered = false;
  async verifyNetwork() {
    if (this.offline) throw new Error('offline');
    return { fixture: true };
  }
  async balance() {
    return 10n ** 18n;
  }
  async prepare(_key: Hex, to: string, amount: bigint, data: Hex) {
    if (this.offline) throw new Error('offline');
    const raw = stringToHex(`FAKE-TRANSACTION-${this.prepared.length}`);
    const p = { raw, hash: keccak256(raw), nonce: this.prepared.length };
    this.prepared.push(p);
    this.transactions.set(p.hash, { to, amount, data });
    return p;
  }
  async broadcast(raw: Hex) {
    this.broadcasts.push(raw);
    if (this.lostResponse) throw new Error('lost response');
  }
  async settlement(hash: Hex, quote: Quote): Promise<Settlement | null> {
    if (this.offline) throw new Error('offline');
    const p = this.prepared.find((p) => p.hash === hash);
    if (!p || !this.broadcasts.includes(p.raw) || this.pending) return null;
    const tx = this.transactions.get(hash)!;
    if (
      tx.to !== quote.payee ||
      tx.amount !== BigInt(quote.price.amountAtomic) ||
      tx.data !== `0x${quote.requestDigest}`
    )
      throw new Error('Wrong payment evidence');
    return { success: !this.revert, fee: '1000', timestamp: new Date().toISOString() };
  }
}
