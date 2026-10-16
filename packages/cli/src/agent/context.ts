import { resolve } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { address, validateConfig, type WalletConfig, publicClient, verifyAccount, type PublicClient, WalletError } from '@stablechain/agent-wallet-sdk/protocol';
import { StateStore } from './state.js';

export class AgentContext {
  readonly state: StateStore;
  constructor(directory = process.env.WALLET_STATE_DIR || resolve(process.cwd(), '.agent-wallet')) { this.state = new StateStore(directory); }
  async config() {
    if (!await this.state.has('config.json')) throw new WalletError('CONFIG_REQUIRED', 'Import operator-provided public settings with config import --file FILE.');
    try { return validateConfig(await this.state.read('config.json')); }
    catch (error) { if (error instanceof WalletError) throw error; throw new WalletError('INVALID_CONFIG', 'Invalid wallet configuration.'); }
  }
  async public(): Promise<{ config: WalletConfig; client: PublicClient }> { const config = await this.config(); return { config, client: publicClient(config.rpcUrl) }; }
  async verify(client: PublicClient, config: WalletConfig) {
    try { await verifyAccount(client, config); }
    catch (error) {
      if (error instanceof Error && error.constructor === Error) throw new WalletError('ACCOUNT_NOT_VERIFIED', error.message);
      throw error;
    }
  }
  async identity() {
    if (!await this.state.has('agent-key.json')) throw new WalletError('AGENT_REQUIRED', 'Run agent-wallet init first.');
    const record = await this.state.read<{ address: string }>('agent-key.json');
    try { return address(record.address, 'agent address'); }
    catch { throw new WalletError('INVALID_KEY_RECORD', 'Agent key record has no valid public address.'); }
  }
  async account() {
    const record = await this.state.read<{ privateKey: Hex; address: string }>('agent-key.json');
    try {
      if (!/^0x[0-9a-fA-F]{64}$/.test(record.privateKey)) throw new Error();
      const account = privateKeyToAccount(record.privateKey);
      if (account.address !== record.address) throw new Error();
      return account;
    } catch { throw new WalletError('INVALID_KEY_RECORD', 'Agent key record is invalid or its address differs. Retain it for recovery.'); }
  }
  async init() {
    return this.state.lock(async () => {
      if (await this.state.has('agent-key.json')) return { address: (await this.account()).address, retained: true, stateDir: this.state.directory };
      const privateKey = generatePrivateKey();
      const account = privateKeyToAccount(privateKey);
      await this.state.write('agent-key.json', { privateKey, address: account.address, createdAt: new Date().toISOString() });
      return { address: account.address, retained: false, stateDir: this.state.directory };
    });
  }
}
