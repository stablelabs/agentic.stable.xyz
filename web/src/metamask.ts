import type { EIP1193Provider } from 'viem';

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
