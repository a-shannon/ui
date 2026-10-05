import type { RosenTokens } from '@rosen-bridge/tokens';
import type { WalletTransferParams } from '@rosen-ui/wallet-api';

import { exampleCalldata, exampleLock, joe } from '../../../networks/avalanche/tests/erc20TestData';
import { avax } from './testData';

/** Contract-generator overlay fixture: the Ergo counterpart identifiers are synthetic. */
export const generatedOverlay: RosenTokens = [
  {
    avalanche: avax,
    ergo: {
      tokenId: '0b'.repeat(32),
      name: 'rsAVAX',
      decimals: 9,
      type: 'EIP-004',
      residency: 'wrapped',
      extra: {},
    },
  },
  {
    avalanche: joe,
    ergo: {
      tokenId: '0c'.repeat(32),
      name: 'rsJOE',
      decimals: 9,
      type: 'EIP-004',
      residency: 'wrapped',
      extra: {},
    },
  },
];

/** Original producer route, keeping the selected real JOE identity and synthetic custody. */
export const tokenTransfer: WalletTransferParams = {
  token: joe,
  amount: 10n,
  fromChain: 'avalanche',
  toChain: 'ergo',
  address: '9iMjQx8PzwBKXRvsFUJFJAPoy31znfEeBUGz8DRkcnJX4rJYjVd',
  lockAddress: exampleLock,
  bridgeFee: 2n,
  networkFee: 3n,
};

/** Single-field faults in a token lock's independent identities and appended payload. */
export const payloadFaults = [
  { to: exampleLock },
  { from: exampleLock },
  { data: '0x00' },
  {
    data: exampleCalldata.replace(
      '1111111111111111111111111111111111111111',
      '2222222222222222222222222222222222222222',
    ),
  },
  { data: exampleCalldata.replace('174876e800', '174876e801') },
  { data: `${exampleCalldata.slice(0, -2)}00` },
  { value: '0x0' },
  { chainId: '0xa869' },
];
