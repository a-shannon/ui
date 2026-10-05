import { getAddress } from 'ethers';

import type { AbstractLogger } from '@rosen-bridge/abstract-logger';
import type { RosenChainToken, TokenMap } from '@rosen-bridge/tokens';

import type { AvalancheCalculatorInterface } from '../../interfaces';
import AbstractCalculator from '../abstract-calculator';

/** AVAX and mapped standard ERC20 accounting; qualified reads never fall back to latest. */
export class AvalancheCalculator extends AbstractCalculator {
  readonly chain = 'avalanche';
  readonly #addresses: readonly string[];
  readonly #config: AvalancheCalculatorInterface;
  readonly #tokenMap: TokenMap;
  readonly #tokens: ReadonlyMap<string, string>;
  readonly #map: string;
  readonly #raw: string;
  readonly #getConfig: TokenMap['getConfig'];
  readonly #getRawConfig: TokenMap['getRawConfig'];
  readonly #wrap: TokenMap['wrapAmount'];
  readonly #assertNetwork: AvalancheCalculatorInterface['source']['assertNetwork'];
  readonly #balance: AvalancheCalculatorInterface['source']['getAddressBalanceForNativeToken'];
  readonly #tokenBalance: AvalancheCalculatorInterface['source']['getAddressBalanceForERC20Asset'];
  readonly #supply: AvalancheCalculatorInterface['source']['getERC20AssetTotalSupply'];

  /** Capture addresses, source methods and the exact token-map policy. */
  constructor(tokenMap: TokenMap, config: AvalancheCalculatorInterface, logger?: AbstractLogger) {
    if (
      !config ||
      ![43113, 43114].includes(config.chainId) ||
      typeof config.sourceId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(config.sourceId) ||
      !Array.isArray(config.addresses) ||
      !config.addresses.length ||
      config.source?.expectedChainId !== BigInt(config.chainId) ||
      typeof config.source.assertNetwork !== 'function' ||
      typeof config.source.getAddressBalanceForNativeToken !== 'function'
    )
      throw new Error('Invalid Avalanche calculator configuration');
    const addresses = Array.from(config.addresses, (address) => getAddress(address));
    if (new Set(addresses).size !== addresses.length || addresses.includes(`0x${'00'.repeat(20)}`))
      throw new Error('Invalid Avalanche calculator addresses');
    const map = tokenMap.getConfig();
    const raw = tokenMap.getRawConfig();
    const sets = map.filter((set) => set.avalanche);
    const native = sets.filter(
      (set) => set.avalanche.type === 'native' || set.avalanche.tokenId === 'avax',
    );
    if (native.length !== 1) throw new Error('Avalanche calculator requires one native AVAX set');
    const identity = (id: string) => (/^0x[0-9a-fA-F]{40}$/.test(id) ? id.toLowerCase() : id);
    for (const set of sets) {
      const { avalanche: token, ergo } = set;
      if (
        (token.type === 'native'
          ? token.tokenId !== 'avax' || token.decimals !== 18 || token.residency !== 'native'
          : token.type !== 'ERC-20' ||
            !/^0x[0-9a-f]{40}$/.test(token.tokenId) ||
            /^0x0{40}$/.test(token.tokenId) ||
            !['native', 'wrapped'].includes(token.residency)) ||
        !ergo ||
        !/^[0-9a-f]{64}$/.test(ergo.tokenId) ||
        /^0+$/.test(ergo.tokenId) ||
        !['EIP-004', 'token'].includes(ergo.type) ||
        !['native', 'wrapped'].includes(ergo.residency) ||
        (token.type === 'native' && ergo.residency !== 'wrapped') ||
        Object.values(set).filter((member) => member.residency === 'native').length !== 1 ||
        Object.values(set).some(
          (member) =>
            !Number.isSafeInteger(member.decimals) || member.decimals < 0 || member.decimals > 18,
        ) ||
        Object.values(set).some(
          (member) =>
            !member.tokenId ||
            raw
              .flatMap((candidate) => Object.values(candidate))
              .filter((other) => identity(other.tokenId) === identity(member.tokenId)).length !== 1,
        )
      )
        throw new Error('Invalid Avalanche native token mapping or ERC-20 token mapping');
    }
    if (
      sets.some((set) => set.avalanche.type !== 'native') &&
      (typeof config.source.getAddressBalanceForERC20Asset !== 'function' ||
        typeof config.source.getERC20AssetTotalSupply !== 'function')
    )
      throw new Error('Avalanche ERC20 calculator requires qualified balance and supply readers');
    super([...addresses], logger, tokenMap);
    this.#addresses = Object.freeze(addresses);
    this.#config = Object.freeze({ ...config, addresses: [...addresses] });
    this.#tokenMap = tokenMap;
    this.#tokens = new Map(
      sets.map((set) => [set.avalanche.tokenId, JSON.stringify(set.avalanche)]),
    );
    this.#map = JSON.stringify(map);
    this.#raw = JSON.stringify(raw);
    this.#getConfig = tokenMap.getConfig;
    this.#getRawConfig = tokenMap.getRawConfig;
    this.#wrap = tokenMap.wrapAmount;
    this.#assertNetwork = config.source.assertNetwork;
    this.#balance = config.source.getAddressBalanceForNativeToken;
    this.#tokenBalance = config.source.getAddressBalanceForERC20Asset;
    this.#supply = config.source.getERC20AssetTotalSupply;
  }

  /** Refuse token-map, token argument or qualified source drift. */
  private assertInput = (token: RosenChainToken): void => {
    const source = this.#config.source;
    if (
      source.expectedChainId !== BigInt(this.#config.chainId) ||
      source.assertNetwork !== this.#assertNetwork ||
      source.getAddressBalanceForNativeToken !== this.#balance ||
      source.getAddressBalanceForERC20Asset !== this.#tokenBalance ||
      source.getERC20AssetTotalSupply !== this.#supply ||
      this.#tokenMap.getConfig !== this.#getConfig ||
      this.#tokenMap.getRawConfig !== this.#getRawConfig ||
      this.#tokenMap.wrapAmount !== this.#wrap ||
      JSON.stringify(this.#getConfig.call(this.#tokenMap)) !== this.#map ||
      JSON.stringify(this.#getRawConfig.call(this.#tokenMap)) !== this.#raw ||
      !token ||
      JSON.stringify(token) !== this.#tokens.get(token.tokenId)
    )
      throw new Error('Avalanche calculator input changed or unsupported');
  };

  /** Read a mapped token's exact finalized totalSupply; native AVAX has no ERC20 issuance cap. */
  totalRawSupply = async (token: RosenChainToken): Promise<bigint> => {
    this.assertInput(token);
    if (token.type === 'native')
      throw new Error('Native AVAX total supply is not available from this calculator');
    await this.#assertNetwork.call(this.#config.source);
    this.assertInput(token);
    const amount = await this.#supply!.call(this.#config.source, token.tokenId);
    this.assertInput(token);
    await this.#assertNetwork.call(this.#config.source);
    this.assertInput(token);
    if (typeof amount !== 'bigint' || amount < 0n || amount >= 1n << 256n)
      throw new Error('Invalid Avalanche token supply');
    return amount;
  };

  /** Wrap the qualified supply using the captured map and fixed chain identity. */
  totalSupply = async (token: RosenChainToken): Promise<bigint> => {
    const total = await this.totalRawSupply(token);
    return this.wrapAmount(token, total);
  };

  /** Read exact selected-asset balances at every captured address with identity rechecks. */
  getRawLockedAmountsPerAddress = async (token: RosenChainToken) => {
    this.assertInput(token);
    const amounts: { address: string; amount: bigint }[] = [];
    for (const address of this.#addresses) {
      await this.#assertNetwork.call(this.#config.source);
      this.assertInput(token);
      const amount =
        token.type === 'native'
          ? await this.#balance.call(this.#config.source, address)
          : await this.#tokenBalance!.call(this.#config.source, address, token.tokenId);
      this.assertInput(token);
      await this.#assertNetwork.call(this.#config.source);
      this.assertInput(token);
      if (typeof amount !== 'bigint' || amount < 0n || amount > (1n << 256n) - 1n)
        throw new Error('Invalid Avalanche native or token balance');
      amounts.push({ address, amount });
    }
    return amounts;
  };

  /** Sum captured hot/cold selected-asset balances without exceeding uint256. */
  totalRawBalance = async (token: RosenChainToken): Promise<bigint> => {
    const rows = await this.getRawLockedAmountsPerAddress(token);
    this.assertInput(token);
    const total = rows.reduce((amount, row) => amount + row.amount, 0n);
    if (total > (1n << 256n) - 1n) throw new Error('Avalanche balance sum exceeds uint256');
    return total;
  };

  /** Convert qualified raw units and refuse conversion-policy changes or invalid results. */
  private wrapAmount = (token: RosenChainToken, amount: bigint): bigint => {
    this.assertInput(token);
    const wrapped = this.#wrap.call(this.#tokenMap, token.tokenId, amount, 'avalanche').amount;
    this.assertInput(token);
    if (typeof wrapped !== 'bigint' || wrapped < 0n || wrapped >= 1n << 256n)
      throw new Error('Invalid Avalanche wrapped amount');
    return wrapped;
  };

  /** Wrap the validated sum using the captured token-map implementation. */
  totalBalance = async (token: RosenChainToken): Promise<bigint> => {
    const total = await this.totalRawBalance(token);
    return this.wrapAmount(token, total);
  };

  /** Wrap each qualified address balance under the same captured selected-asset policy. */
  getLockedAmountsPerAddress = async (token: RosenChainToken) => {
    const rows = await this.getRawLockedAmountsPerAddress(token);
    this.assertInput(token);
    return rows.map(({ address, amount }) => ({
      address,
      amount: this.wrapAmount(token, amount),
    }));
  };
}
