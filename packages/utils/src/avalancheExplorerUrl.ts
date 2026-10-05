/** Selects the C-Chain explorer only after an explicit EVM network selection. */
export const avalancheExplorerUrl = (chainId?: number): `https://${string}` | undefined => {
  if (chainId === 43113) return 'https://testnet.snowtrace.io';
  if (chainId === 43114) return 'https://snowtrace.io';
  return undefined;
};
