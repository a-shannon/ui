import { Interface, isAddress as isValidAddress } from 'ethers';

import { Avalanche as AvalancheIcon } from '@rosen-bridge/icons';
import type { TokenMap } from '@rosen-bridge/tokens';
import type { Network, NetworkConfig } from '@rosen-network/base';
import type { generateLockData, generateTxParameters } from '@rosen-network/evm';
import { NETWORKS } from '@rosen-ui/constants';

import { type AvalancheChainId, assertAvalancheChainId } from './constants';
import {
  assertAvalancheLockAmount,
  assertAvalancheToken,
  captureAvalancheTokenPolicy,
} from './tokenPolicy';

export type AvalancheNetworkConfig = NetworkConfig & {
  chainId: AvalancheChainId;
  getProviderChainId: () => Promise<number | bigint>;
  getWalletChainId: () => Promise<number | bigint>;
  getTokenMap: () => Promise<TokenMap>;
  generateLockData: typeof generateLockData;
  generateTxParameters: ReturnType<typeof generateTxParameters>;
};

/** AVAX and mapped ERC20 network facade for the Rosen application. */
export class AvalancheNetwork implements Network {
  public readonly label = NETWORKS.avalanche.label;
  public readonly name = NETWORKS.avalanche.key;
  public readonly logo = AvalancheIcon;
  public readonly lockAddress: string;
  public readonly nextHeightInterval: number;
  public readonly chainId: AvalancheChainId;
  private readonly config: AvalancheNetworkConfig;

  /** Pin the explicit deployment, nonzero custody and configured action callbacks. */
  constructor(config: AvalancheNetworkConfig) {
    assertAvalancheChainId(config.chainId);
    if (typeof config.getTokenMap !== 'function')
      throw new Error('Avalanche requires a token map reader');
    if (!isValidAddress(config.lockAddress) || /^0x0{40}$/i.test(config.lockAddress))
      throw new Error('Invalid Avalanche lock address');
    if (!Number.isSafeInteger(config.nextHeightInterval) || config.nextHeightInterval < 0) {
      throw new Error('Invalid Avalanche fee height interval');
    }
    this.config = Object.freeze({ ...config });
    this.chainId = config.chainId;
    this.lockAddress = config.lockAddress;
    this.nextHeightInterval = config.nextHeightInterval;
  }

  /** Obtain Rosen fees through the configured server action. */
  public calculateFee: AvalancheNetworkConfig['calculateFee'] = (...args) => {
    return this.config.calculateFee(...args);
  };

  /** Encode metadata through the shared EVM encoder and its configured route table. */
  public generateLockData: AvalancheNetworkConfig['generateLockData'] = (...args) => {
    return this.config.generateLockData(...args);
  };

  /** Bind a native or direct ERC20 lock to the selected provider and wallet network. */
  public generateTxParameters = async (
    ...args: Parameters<AvalancheNetworkConfig['generateTxParameters']>
  ) => {
    const [tokenId, lockAddress, fromAddress, amount, data, token, fromChain] = args;
    assertAvalancheToken(token);
    if (fromChain !== this.name || tokenId !== token.tokenId) {
      throw new Error('Invalid Avalanche asset or source chain');
    }
    if (typeof amount !== 'bigint' || amount <= 0n) throw new Error('Invalid Avalanche amount');
    if (
      !isValidAddress(fromAddress) ||
      !isValidAddress(lockAddress) ||
      lockAddress.toLowerCase() !== this.config.lockAddress.toLowerCase()
    ) {
      throw new Error('Invalid Avalanche lock transaction address');
    }
    if (
      !/^(?:[0-9a-f]{2}){19,273}$/.test(data) ||
      Number.parseInt(data.slice(34, 36), 16) !== (data.length - 36) / 2
    ) {
      throw new Error('Invalid Rosen lock metadata');
    }
    const pinnedToken = Object.freeze({ ...token });
    assertAvalancheLockAmount(
      amount,
      BigInt(`0x${data.slice(2, 18)}`),
      BigInt(`0x${data.slice(18, 34)}`),
    );
    const tokenMap = await this.config.getTokenMap();
    const policy = captureAvalancheTokenPolicy(tokenMap, pinnedToken);
    const rawAmount = policy.unwrapAmount(amount).amount;
    if (rawAmount <= 0n) throw new Error('Invalid Avalanche raw amount');
    const expectedValue = policy.isNative ? `0x${rawAmount.toString(16)}` : undefined;
    const expectedTo = policy.isNative ? lockAddress : tokenId;
    const expectedData = policy.isNative
      ? `0x${data}`
      : new Interface(['function transfer(address,uint256)']).encodeFunctionData('transfer', [
          lockAddress,
          rawAmount,
        ]) + data;
    await this.assertNetworkIdentity();
    const transaction = await this.config.generateTxParameters(
      tokenId,
      lockAddress,
      fromAddress,
      amount,
      data,
      pinnedToken,
      fromChain,
    );
    await this.assertNetworkIdentity();
    policy.assertCurrent();
    if (
      transaction.to.toLowerCase() !== expectedTo.toLowerCase() ||
      transaction.from.toLowerCase() !== fromAddress.toLowerCase() ||
      transaction.data !== expectedData ||
      transaction.value !== expectedValue
    ) {
      throw new Error('Invalid Avalanche transaction parameters');
    }
    return {
      to: transaction.to,
      from: transaction.from,
      data: transaction.data,
      ...(policy.isNative ? { value: transaction.value } : {}),
      chainId: `0x${this.config.chainId.toString(16)}`,
    };
  };

  /** Obtain the transferable balance through the configured qualified provider. */
  public getMaxTransfer: AvalancheNetworkConfig['getMaxTransfer'] = (...args) => {
    const { isNative, token } = args[0];
    if (!isNative && !token) throw new Error('Avalanche token maximum requires asset identity');
    if (token) {
      assertAvalancheToken(token);
      if (isNative !== (token.type === 'native'))
        throw new Error('Avalanche maximum asset mismatch');
    }
    return this.config.getMaxTransfer(...args);
  };

  /** Obtain the minimum transfer through the configured Rosen fee action. */
  public getMinTransfer: AvalancheNetworkConfig['getMinTransfer'] = (...args) => {
    const [token] = args;
    assertAvalancheToken(token);
    return this.config.getMinTransfer(...args);
  };

  /** Normalize a validated EVM address without changing its identity. */
  public toSafeAddress = (address: string): string => {
    if (!isValidAddress(address)) throw new Error('Invalid Avalanche address');
    return address.toLowerCase();
  };

  /** Validate the C-Chain address through the shared codec action. */
  public validateAddress = (address: string): Promise<boolean> => {
    return this.config.validateAddress(this.name, address);
  };

  /** Reject provider or wallet movement before exposing transaction parameters. */
  private assertNetworkIdentity = async (): Promise<void> => {
    const [providerChainId, walletChainId] = await Promise.all([
      this.config.getProviderChainId(),
      this.config.getWalletChainId(),
    ]);
    if (
      !['number', 'bigint'].includes(typeof providerChainId) ||
      BigInt(providerChainId) !== BigInt(this.config.chainId)
    ) {
      throw new Error('Avalanche provider chain mismatch');
    }
    if (
      !['number', 'bigint'].includes(typeof walletChainId) ||
      BigInt(walletChainId) !== BigInt(this.config.chainId)
    ) {
      throw new Error('Avalanche wallet chain mismatch');
    }
  };
}
