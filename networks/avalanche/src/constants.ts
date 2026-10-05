/** Supported Avalanche C-Chain deployment identities; there is no default. */
export type AvalancheChainId = 43113 | 43114;

export const AVALANCHE_CHAIN = 'avalanche';
export const AVALANCHE_NATIVE_TOKEN = 'avax';
export const AVALANCHE_NATIVE_DECIMALS = 18;

/** Reject an unspecified chain or a chain outside Avalanche C-Chain. */
export const assertAvalancheChainId: (chainId: number) => asserts chainId is AvalancheChainId = (
  chainId,
) => {
  if (chainId !== 43113 && chainId !== 43114) {
    throw new Error('Avalanche C-Chain ID must be explicitly selected');
  }
};
