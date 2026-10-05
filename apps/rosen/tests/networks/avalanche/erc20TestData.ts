import type { RosenChainToken } from '@rosen-bridge/tokens';

/** Mainnet JOE identity with synthetic counterpart and custody fixtures. */
export const joe: RosenChainToken = {
  tokenId: '0x6e84a6216ea6dacc71ee8e6b0a5b7322eebc0fdd',
  name: 'JOE',
  decimals: 18,
  type: 'ERC-20',
  residency: 'native',
  extra: {},
};
/** Frozen generic-producer example's source address and exact metadata/calldata. */
export const sender = '0x8c5c59c57b660b323ec5e9b48fdb95a99fde84ce';
export const metadata =
  '00000000000000000200000000000000032103f999da8e6e42660e4464d17d29e63bc006734a6710a24eb489b466323d3a9339';
export const calldata =
  '0xa9059cbb0000000000000000000000001111111111111111111111111111111111111111000000000000000000000000000000000000000000000000000000174876e80000000000000000000200000000000000032103f999da8e6e42660e4464d17d29e63bc006734a6710a24eb489b466323d3a9339';
/** Each mutation isolates a selected-asset or conversion-policy defect. */
export const mapFaults = [
  'token type',
  'raw decimals',
  'Ergo type',
  'Ergo residency',
  'Ergo ID',
  'duplicate token',
  'duplicate counterpart',
] as const;
/** Each returned observer mismatch isolates one selected-chain authority. */
export const chainFaults = ['provider', 'wallet'] as const;
