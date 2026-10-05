import { avalancheGuardAssetsReader } from './guardAssetsBalance';

/** Projects each filtered native custody page into the existing network card. */
const decode = (value: unknown) => {
  /** Converts one independently validated native custody page into card rows. */
  const page = (custody: 'hot' | 'cold') => {
    const selected = avalancheGuardAssetsReader.decode(value, 0, 1, custody);
    if (selected.total > 1 || selected.items.some((item) => item.tokenId !== 'avax')) {
      throw new Error('Invalid Avalanche native guard balance');
    }
    return {
      total: selected.total,
      items: selected.items.map((item) => ({
        address: item.balanceAddress,
        addressUrl: item.balanceAddressUrl,
        chain: item.chain,
        balance: {
          tokenId: 'avax' as const,
          amount: item.amount,
          decimals: item.decimals,
          name: item.name,
          isNativeToken: true as const,
        },
      })),
    };
  };
  return { hot: page('hot'), cold: page('cold') };
};

export const avalancheGuardBalanceReader = {
  key: ['/balance', { chain: 'avalanche', tokenId: 'avax', offset: 0, limit: 1 }] as const,
  decode,
};
