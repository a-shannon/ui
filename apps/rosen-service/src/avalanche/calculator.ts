import { type AbstractLogger, DummyLogger } from '@rosen-bridge/abstract-logger';
import { type AvalancheRpcScanner, AvalancheSafetyState } from '@rosen-bridge/evm-scanner';
import type { DataSource } from '@rosen-bridge/extended-typeorm';
import { AvalancheRpcNetwork } from '@rosen-chains/avalanche-rpc';
import type { AvalancheCalculatorInterface } from '@rosen-ui/asset-calculator';

import { type AvalancheServiceConfig, selectedAvalancheEndpoint } from './config';

/** Bind finalized native/token balances and supply to the scanner's persisted source identity. */
export const createAvalancheCalculatorConfig = (
  config: AvalancheServiceConfig,
  dataSource: DataSource,
  scanner: AvalancheRpcScanner | undefined,
  logger: AbstractLogger = new DummyLogger(),
): AvalancheCalculatorInterface => {
  if (scanner?.name() !== 'avalanche') throw new Error('Avalanche scanner is required');
  const endpoint = selectedAvalancheEndpoint(config);
  const chainId = config.chainId;
  const sourceId = endpoint.sourceId;
  const initialHeight = config.initialHeight;
  const network = new AvalancheRpcNetwork(
    endpoint.url,
    dataSource,
    config.addresses.lock,
    BigInt(chainId),
    'avalanche-service-balance',
    endpoint.timeoutMs,
    endpoint.authToken,
    logger,
  );

  /** Reject mismatched or newly held persisted policy before and after each balance read. */
  const assertPolicy = async () => {
    await scanner.assertUsable();
    const state = await dataSource
      .getRepository(AvalancheSafetyState)
      .findOneBy({ scanner: scanner.name() });
    if (
      !state ||
      state.chainId !== chainId.toString() ||
      state.sourceId !== sourceId ||
      state.initialHeight !== initialHeight
    ) {
      throw new Error('Avalanche calculator and scanner policy mismatch');
    }
  };

  return {
    chainId,
    sourceId,
    addresses: [...config.calculatorAddresses],
    source: Object.freeze({
      expectedChainId: BigInt(chainId),
      /** Verify fresh RPC identity under the scanner's safety exclusion. */
      assertNetwork: async () =>
        scanner.withSafety(async () => {
          await assertPolicy();
          await network.assertNetwork();
          await assertPolicy();
        }),
      /** Read canonical finalized native AVAX without a latest fallback. */
      getAddressBalanceForNativeToken: async (address: string) =>
        scanner.withSafety(async () => {
          await assertPolicy();
          const amount = await network.getAddressBalanceForNativeToken(address);
          await assertPolicy();
          return amount;
        }),
      /** Read exact finalized ERC20 balance within the same persisted safety exclusion. */
      getAddressBalanceForERC20Asset: async (address: string, tokenId: string) =>
        scanner.withSafety(async () => {
          await assertPolicy();
          const amount = await network.getAddressBalanceForERC20Asset(address, tokenId);
          await assertPolicy();
          return amount;
        }),
      /** Read finalized ERC20 supply; never substitute the inherited latest contract reader. */
      getERC20AssetTotalSupply: async (tokenId: string) =>
        scanner.withSafety(async () => {
          await assertPolicy();
          const amount = await network.getERC20AssetTotalSupply(tokenId);
          await assertPolicy();
          return amount;
        }),
    }),
  };
};
