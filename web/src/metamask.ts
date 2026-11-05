import type { EIP1193Provider } from 'viem';
import { chain, CHAIN_ID, EXPLORER } from '../../shared/owner.js';

export type Provider = EIP1193Provider & {
  isMetaMask?: boolean; isRabby?: boolean; providers?: Provider[];
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};
declare global { interface Window { ethereum?: Provider } }
export async function metaMask(): Promise<Provider> {
  let selected: Provider | undefined;
  const announced = (event: Event) => {
    const detail = (event as CustomEvent<{ info: { rdns: string }; provider: Provider }>).detail;
    if (detail?.info?.rdns === 'io.metamask') selected = detail.provider;
  };
  window.addEventListener('eip6963:announceProvider', announced);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  await new Promise(resolve => setTimeout(resolve, 250));
  window.removeEventListener('eip6963:announceProvider', announced);
  selected ??= window.ethereum?.providers?.find(p => p.isMetaMask && !p.isRabby);
  if (!selected && window.ethereum?.isMetaMask && !window.ethereum.isRabby) selected = window.ethereum;
  if (!selected) throw new Error('MetaMask was not found. Install and unlock the MetaMask extension, then reload this page, or open this site in MetaMask’s mobile browser.');
  return selected;
}

export const STABLE_TESTNET_HEX = `0x${CHAIN_ID.toString(16)}` as const;

/**
 * Asks the wallet to add Stable Testnet. Used on its own (no account access, no transaction)
 * and by the connect flow when the wallet does not know the chain yet.
 */
export async function addStableTestnet(provider: Provider, rpcUrl: string = chain.rpcUrls.default.http[0]) {
  await provider.request({
    method: 'wallet_addEthereumChain',
    params: [
      {
        chainId: STABLE_TESTNET_HEX,
        chainName: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: [rpcUrl],
        blockExplorerUrls: [EXPLORER],
      },
    ],
  });
}
