import { avalancheGuardBalanceReader } from '@rosen-network/avalanche';
import type { Network } from '@rosen-ui/types';

import type { TokenInfoWithAddress } from '@/types/api';

export type GuardBalanceItem = Omit<TokenInfoWithAddress, 'balance'> & {
  balance: Omit<TokenInfoWithAddress['balance'], 'amount'> & { amount: number | bigint };
};

export type GuardBalanceView = {
  hot: { items: GuardBalanceItem[]; total: number };
  cold: { items: GuardBalanceItem[]; total: number };
};

type GuardBalanceReader = {
  key: readonly [string, Readonly<Record<string, string | number>>];
  decode: (value: unknown) => GuardBalanceView;
};

export const guardBalanceReaders: Partial<Record<Network, GuardBalanceReader>> = {
  avalanche: avalancheGuardBalanceReader,
};
