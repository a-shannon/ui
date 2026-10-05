import type { RosenChainToken } from '@rosen-bridge/tokens';

/** Synthetic nonzero custody used by App deployment and lock-action fixtures. */
export const lock = `0x${'11'.repeat(20)}`;
/** Synthetic sender account distinct from the custody and destination. */
export const sender = `0x${'22'.repeat(20)}`;
/** Synthetic receiving account for native return-route fixtures. */
export const destination = `0x${'33'.repeat(20)}`;
/** Native-resident AVAX definition with C-Chain's 18 raw decimal places. */
export const avax: RosenChainToken = {
  tokenId: 'avax',
  name: 'AVAX',
  decimals: 18,
  type: 'native',
  residency: 'native',
  extra: {},
};
/** Fuji action policy with synthetic destination index100 and bounded gas reserve. */
export const actionConfig = {
  chainId: 43113 as const,
  rosenChainIndex: 100,
  lockAddress: lock,
  nextHeightInterval: 50,
  gasReserveLimit: 30000n,
};
/** Serializable Fuji selection carrying the same synthetic policy as actionConfig. */
export const selected = {
  chainId: 43113,
  rosenChainIndex: 100,
  nextHeightInterval: 50,
  gasReserveLimit: '30000',
};
