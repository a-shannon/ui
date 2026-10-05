import type { RosenChainToken } from '@rosen-bridge/tokens';
import type { WalletTransferParams } from '@rosen-ui/wallet-api';

/** Synthetic native AVAX transfer with public-style EVM addresses and no live funds. */
export const sender = `0x${'22'.repeat(20)}`;
export const lock = `0x${'33'.repeat(20)}`;
export const destination = `0x${'11'.repeat(20)}`;
export const metadata = `030000000000000002000000000000000314${'11'.repeat(20)}`;
export const avax: RosenChainToken = {
  tokenId: 'avax',
  name: 'AVAX',
  decimals: 18,
  type: 'native',
  residency: 'native',
  extra: {},
};
export const transfer: WalletTransferParams = {
  token: avax,
  amount: 10n,
  fromChain: 'avalanche',
  toChain: 'ethereum',
  address: destination,
  bridgeFee: 2n,
  networkFee: 3n,
  lockAddress: lock,
};
