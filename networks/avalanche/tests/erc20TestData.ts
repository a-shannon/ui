import type { RosenChainToken } from '@rosen-bridge/tokens';

/** Mainnet JOE identity; all custody and counterpart identities below are synthetic. */
export const joe: RosenChainToken = {
  tokenId: '0x6e84a6216ea6dacc71ee8e6b0a5b7322eebc0fdd',
  name: 'JOE',
  decimals: 18,
  type: 'ERC-20',
  residency: 'native',
  extra: {},
};
/** Synthetic Ergo representation with eight significant decimal places. */
export const joeCounterpart = '66'.repeat(32);
/** Frozen preimplementation producer example's custody and recovered fixture sender. */
export const exampleLock = `0x${'11'.repeat(20)}`;
export const exampleSender = '0x8c5c59c57b660b323ec5e9b48fdb95a99fde84ce';
/** Frozen generic producer metadata: Ergo destination and wrapped fees two plus three. */
export const exampleMetadata =
  '00000000000000000200000000000000032103f999da8e6e42660e4464d17d29e63bc006734a6710a24eb489b466323d3a9339';
/** Frozen preimplementation transfer calldata; the trailing bytes are Rosen metadata. */
export const exampleCalldata =
  '0xa9059cbb0000000000000000000000001111111111111111111111111111111111111111000000000000000000000000000000000000000000000000000000174876e80000000000000000000200000000000000032103f999da8e6e42660e4464d17d29e63bc006734a6710a24eb489b466323d3a9339';

/** One-field input faults that cannot be repaired by an unrelated valid field. */
export const tokenFaults = [
  { tokenId: `0x${'00'.repeat(20)}` },
  { tokenId: 'garbage' },
  { type: 'token' },
  { residency: 'unknown' },
  { decimals: -1 },
  { decimals: 19 },
];
/** Independent producer mutations in the token transfer's custody, amount and metadata. */
export const returnedFaults = [
  { to: exampleLock },
  { from: exampleLock },
  { value: '0x1' },
  { value: '0x0' },
  {
    data: exampleCalldata.replace(
      '1111111111111111111111111111111111111111',
      '2222222222222222222222222222222222222222',
    ),
  },
  { data: exampleCalldata.replace('174876e800', '174876e801') },
  { data: `${exampleCalldata.slice(0, -2)}00` },
];
