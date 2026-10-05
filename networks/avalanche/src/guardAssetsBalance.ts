import { avalancheExplorerUrl } from '@rosen-ui/utils';

/** Requires a non-array object before reading untrusted cached balance fields. */
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Avalanche guard assets');
  }
  return value as Record<string, unknown>;
};

/** Validates safe nonnegative offsets and the supported one-to-100 page size. */
const assertPage = (offset: number, limit: number) => {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw new Error('Invalid Avalanche guard assets pagination');
  }
};

/** Decodes already wrapped cached units using the backend's significant decimals. */
const decode = (value: unknown, offset: number, limit: number, custody: 'hot' | 'cold' = 'hot') => {
  assertPage(offset, limit);
  if (custody !== 'hot' && custody !== 'cold') throw new Error('Invalid Avalanche guard custody');
  const response = record(value);
  if (response.chainId !== 43113 && response.chainId !== 43114) {
    throw new Error('Invalid Avalanche guard deployment');
  }
  const explorer = avalancheExplorerUrl(response.chainId);
  if (!explorer) throw new Error('Invalid Avalanche guard deployment');
  const page = record(response[custody]);
  if (
    !Array.isArray(page.items) ||
    typeof page.total !== 'number' ||
    !Number.isSafeInteger(page.total) ||
    page.total < 0 ||
    page.items.length !== Math.min(limit, Math.max(page.total - offset, 0))
  ) {
    throw new Error('Invalid Avalanche guard assets page');
  }
  const identities = new Set<string>();
  let address: string | undefined;
  const items = page.items.map((value: unknown) => {
    const item = record(value);
    const balance = record(item.balance);
    const tokenId = balance.tokenId;
    if (
      item.chain !== 'avalanche' ||
      typeof item.address !== 'string' ||
      !/^0x[0-9a-fA-F]{40}$/.test(item.address) ||
      /^0x0{40}$/.test(item.address) ||
      (address !== undefined && item.address !== address) ||
      typeof tokenId !== 'string' ||
      (tokenId !== 'avax' && (!/^0x[0-9a-fA-F]{40}$/.test(tokenId) || /^0x0{40}$/.test(tokenId))) ||
      balance.isNativeToken !== (tokenId === 'avax') ||
      typeof balance.amount !== 'string' ||
      !/^(0|[1-9][0-9]{0,77})$/.test(balance.amount) ||
      BigInt(balance.amount) >= 1n << 256n ||
      typeof balance.decimals !== 'number' ||
      !Number.isSafeInteger(balance.decimals) ||
      balance.decimals < 0 ||
      balance.decimals > 99 ||
      (balance.name !== undefined && typeof balance.name !== 'string') ||
      identities.has(tokenId.toLowerCase())
    ) {
      throw new Error('Invalid Avalanche guard asset');
    }
    address = item.address;
    identities.add(tokenId.toLowerCase());
    return {
      chain: 'avalanche' as const,
      hotAddress: custody === 'hot' ? item.address : undefined,
      balanceAddress: item.address,
      balanceAddressUrl: `${explorer}/address/${item.address}`,
      balanceLabel: custody === 'hot' ? ('Hot' as const) : ('Cold' as const),
      tokenId,
      tokenUrl: tokenId === 'avax' ? undefined : `${explorer}/token/${tokenId}`,
      amount: BigInt(balance.amount),
      decimals: balance.decimals,
      name: balance.name as string | undefined,
      isNativeToken: tokenId === 'avax',
      coldAmount: undefined,
    };
  });
  return { items, total: page.total };
};

export const avalancheGuardAssetsReader = {
  /** Builds the Avalanche-only cache request for the independently selected page. */
  key: (offset: number, limit: number) => {
    assertPage(offset, limit);
    return ['/balance', { chain: 'avalanche', offset, limit }] as const;
  },
  decode,
};
