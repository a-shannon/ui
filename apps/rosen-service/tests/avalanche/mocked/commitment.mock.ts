import { DataSource } from '@rosen-bridge/extended-typeorm';
import { NETWORKS_KEYS } from '@rosen-ui/constants';

import { ergoAddress } from '../testData';

interface CommitmentPolicy {
  addresses: { commitment: string };
  tokens: { rwt: string };
  explorerUrl?: string;
}

/** Build isolated deployment policies for the conventional legacy commitment loop. */
const createPolicies = (): Record<string, CommitmentPolicy | undefined> => {
  const result: Record<string, CommitmentPolicy | undefined> = {};
  for (const key of NETWORKS_KEYS) {
    result[key === 'bitcoin-runes' ? 'bitcoinRunes' : key] =
      key === 'avalanche'
        ? undefined
        : {
            addresses: { commitment: ergoAddress },
            tokens: { rwt: '22'.repeat(32) },
          };
  }
  return result;
};

/** Legacy deployment policies with Avalanche excluded from the conventional commitment loop. */
export const commitmentPolicies: Record<string, CommitmentPolicy | undefined> & {
  ergo: CommitmentPolicy & { explorerUrl: string };
} = {
  ...createPolicies(),
  ergo: {
    addresses: { commitment: ergoAddress },
    tokens: { rwt: '22'.repeat(32) },
    explorerUrl: 'https://ergo.example.invalid',
  },
};

/** Uninitialized database source used to compose the commitment service without database I/O. */
export const commitmentSource = new DataSource({ type: 'postgres', entities: [], migrations: [] });
