import { defineChain, getAddress, isAddress, type Address, type Hex } from 'viem';

export const CHAIN_ID = 2201;
export const TOKEN = '0x78Cf24370174180738C5B8E352B6D14c83a6c9A9' as Address;
export const RPC = 'https://rpc.testnet.stable.xyz';
export const EXPLORER = 'https://testnet.stablescan.xyz';
export const DECIMALS = 6;
export const chain = defineChain({
  id: CHAIN_ID, name: 'Stable Testnet', nativeCurrency: { name: 'USDT0', symbol: 'USDT0', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } }, blockExplorers: { default: { name: 'Stablescan', url: EXPLORER } }, testnet: true,
});
export type WalletConfig = {
  schemaVersion: 2; chainId: 2201; rpcUrl: string; token: Address; alice: Address; approvalUrl: string;
  defaultAgent?: Address;
};
export function address(value: string, label = 'address'): Address {
  if (!isAddress(value) || /^0x0{40}$/i.test(value)) throw new Error(`Invalid ${label}.`);
  return getAddress(value);
}
export function identifier(value: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/.test(value)) throw new Error('Expected a nonzero 32-byte ID.');
  return value.toLowerCase() as Hex;
}
export function validateConfig(raw: unknown): WalletConfig {
  const c = raw as WalletConfig;
  if (!c || c.schemaVersion !== 2 || c.chainId !== CHAIN_ID || c.token?.toLowerCase() !== TOKEN.toLowerCase()) throw new Error('Only Stable Testnet USDT0 is supported.');
  address(c.alice, 'owner address');
  const rpc = new URL(c.rpcUrl);
  if (rpc.protocol !== 'https:' && !(rpc.protocol === 'http:' && ['127.0.0.1','localhost'].includes(rpc.hostname))) throw new Error('RPC must use HTTPS or local loopback.');
  const approval = new URL(c.approvalUrl);
  if (approval.protocol !== 'https:' && !(approval.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(approval.hostname))) throw new Error('Approval URL must use HTTPS or local loopback.');
  // Reconstruct the public schema so additional local fields can never reach the browser.
  return { schemaVersion: 2, chainId: CHAIN_ID, rpcUrl: c.rpcUrl, token: TOKEN, alice: address(c.alice), approvalUrl: c.approvalUrl, ...(c.defaultAgent ? { defaultAgent: address(c.defaultAgent) } : {}) };
}
