import type { RosenChainToken, TokenMap } from '@rosen-bridge/tokens';

/** Reject unsupported asset definitions before fetching a map or fee evidence. */
export const assertAvalancheToken = (token: RosenChainToken): void => {
  if (
    !token ||
    !Number.isSafeInteger(token.decimals) ||
    token.decimals < 0 ||
    token.decimals > 18 ||
    (token.type === 'native'
      ? token.tokenId !== 'avax' || token.decimals !== 18 || token.residency !== 'native'
      : token.type !== 'ERC-20' ||
        !['native', 'wrapped'].includes(token.residency) ||
        !/^0x[0-9a-f]{40}$/.test(token.tokenId) ||
        /^0x0{40}$/.test(token.tokenId))
  ) {
    throw new Error('Invalid Avalanche token definition');
  }
};

/** Capture the actual conversion policy, including unbridgeable sets searched by TokenMap. */
export const captureAvalancheTokenPolicy = (tokenMap: TokenMap, token?: RosenChainToken) => {
  if (token) assertAvalancheToken(token);
  const read = tokenMap.getRawConfig;
  if (typeof read !== 'function') throw new Error('Avalanche requires a complete token map');
  const raw = read.call(tokenMap);
  const sets = raw.filter((set) => set.avalanche);
  const native = sets.filter(
    (set) => set.avalanche.tokenId === 'avax' || set.avalanche.type === 'native',
  );
  if (native.length !== 1) throw new Error('Avalanche requires one native AVAX token set');
  /** Compare EVM identifiers by address identity even outside bridgeable sets. */
  const identity = (id: string) => (/^0x[0-9a-fA-F]{40}$/.test(id) ? id.toLowerCase() : id);
  for (const set of sets) {
    const { avalanche: asset, ergo } = set;
    try {
      assertAvalancheToken(asset);
    } catch {
      throw new Error('Invalid Avalanche native token mapping or ERC-20 token mapping');
    }
    if (
      !ergo ||
      !/^[0-9a-f]{64}$/.test(ergo.tokenId) ||
      /^0+$/.test(ergo.tokenId) ||
      !['token', 'EIP-004'].includes(ergo.type) ||
      !['native', 'wrapped'].includes(ergo.residency) ||
      (asset.type === 'native' && ergo.residency !== 'wrapped') ||
      Object.values(set).filter((member) => member.residency === 'native').length !== 1 ||
      Object.values(set).some(
        (member) =>
          !Number.isSafeInteger(member.decimals) || member.decimals < 0 || member.decimals > 18,
      ) ||
      Object.values(set).some(
        (member) =>
          typeof member.tokenId !== 'string' ||
          !member.tokenId ||
          raw
            .flatMap((candidate) => Object.values(candidate))
            .filter((other) => identity(other.tokenId) === identity(member.tokenId)).length !== 1,
      )
    )
      throw new Error('Invalid Avalanche native token mapping or ERC-20 token mapping');
  }
  const selected = sets.filter((set) => set.avalanche.tokenId === (token?.tokenId ?? 'avax'));
  const asset = selected[0]?.avalanche;
  if (
    selected.length !== 1 ||
    (token &&
      (token.type !== asset.type ||
        token.residency !== asset.residency ||
        token.decimals !== asset.decimals))
  ) {
    throw new Error('Invalid Avalanche native token mapping or ERC-20 token mapping');
  }
  const policy = JSON.stringify(raw);
  const wrap = tokenMap.wrapAmount;
  const unwrap = tokenMap.unwrapAmount;
  const search = tokenMap.search;
  const getSet = tokenMap.getTokenSet;
  /** Reject map contents or conversion methods that changed after policy capture. */
  const assertCurrent = () => {
    if (
      tokenMap.getRawConfig !== read ||
      tokenMap.wrapAmount !== wrap ||
      tokenMap.unwrapAmount !== unwrap ||
      tokenMap.search !== search ||
      tokenMap.getTokenSet !== getSet ||
      JSON.stringify(read.call(tokenMap)) !== policy
    ) {
      throw new Error('Avalanche token map changed during the operation');
    }
  };
  /** Convert through the captured map method and recheck policy and uint256 bounds. */
  const convert = (method: TokenMap['wrapAmount'], amount: bigint) => {
    assertCurrent();
    const result = method.call(tokenMap, asset.tokenId, amount, 'avalanche');
    assertCurrent();
    if (typeof result.amount !== 'bigint' || result.amount < 0n || result.amount >= 1n << 256n) {
      throw new Error('Invalid Avalanche amount conversion');
    }
    return result;
  };
  return Object.freeze({
    tokenId: asset.tokenId,
    isNative: asset.type === 'native',
    assertCurrent,
    /** Convert the selected asset into wrapped units under the captured policy. */
    wrapAmount: (amount: bigint) => convert(wrap, amount),
    /** Convert wrapped units into the selected asset under the captured policy. */
    unwrapAmount: (amount: bigint) => convert(unwrap, amount),
  });
};

/** Require a funded lock after the two wrapped-unit Rosen fee fields are deducted. */
export const assertAvalancheLockAmount = (
  amount: bigint,
  bridgeFee: bigint,
  networkFee: bigint,
) => {
  if (
    typeof amount !== 'bigint' ||
    amount <= 0n ||
    typeof bridgeFee !== 'bigint' ||
    bridgeFee < 0n ||
    bridgeFee > 0xffffffffffffffffn ||
    typeof networkFee !== 'bigint' ||
    networkFee < 0n ||
    networkFee > 0xffffffffffffffffn ||
    amount <= bridgeFee + networkFee
  ) {
    throw new Error('Avalanche lock amount must exceed valid Rosen fees');
  }
};
