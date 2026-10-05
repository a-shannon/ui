import type { RosenChainToken } from '@rosen-bridge/tokens';

/** Synthetic nonzero C-Chain sender for native transaction fixtures. */
export const sender = `0x${'22'.repeat(20)}`;
/** Synthetic nonzero custody address distinct from the sender. */
export const lock = `0x${'33'.repeat(20)}`;
/** Native maximum-transfer input with a synthetic Ergo destination and raw balance. */
export const maxTransferInput = {
  balance: 10000n,
  isNative: true,
  eventData: { toChain: 'ergo' as const, fromAddress: sender, toAddress: 'synthetic' },
};
/** EVM metadata encoding the fixture's target and bridge/network fee values. */
export const metadata = `030000000000000002000000000000000314${'11'.repeat(20)}`;
/** Native-resident AVAX definition with C-Chain's 18 raw decimal places. */
export const avax: RosenChainToken = {
  tokenId: 'avax',
  name: 'AVAX',
  decimals: 18,
  type: 'native',
  residency: 'native',
  extra: {},
};
