/** Serialize a synthetic deployment for the real Avalanche selection parser. */
export const createExplorerDeployment = (chainId: number | undefined) =>
  chainId === undefined
    ? undefined
    : JSON.stringify({
        chainId,
        rosenChainIndex: 100,
        gasReserveLimit: '30000',
        nextHeightInterval: 50,
      });
