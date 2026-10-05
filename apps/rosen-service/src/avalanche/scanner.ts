import { type AbstractLogger, DummyLogger } from '@rosen-bridge/abstract-logger';
import { AvalancheRpcObservationExtractor } from '@rosen-bridge/evm-observation-extractor';
import { AvalancheRpcNetwork, AvalancheRpcScanner } from '@rosen-bridge/evm-scanner';
import type { DataSource } from '@rosen-bridge/extended-typeorm';
import type { TokenMap } from '@rosen-bridge/tokens';

import { type AvalancheServiceConfig, selectedAvalancheEndpoint } from './config';

/** Construct the settled scanner and register its real Avalanche observation extractor. */
export const createAvalancheScanner = async (
  config: AvalancheServiceConfig,
  dataSource: DataSource,
  tokens: TokenMap,
  logger: AbstractLogger = new DummyLogger(),
): Promise<AvalancheRpcScanner> => {
  const endpoint = selectedAvalancheEndpoint(config);
  const network = new AvalancheRpcNetwork(
    endpoint.url,
    BigInt(config.chainId),
    endpoint.timeoutMs,
    endpoint.authToken,
  );
  const scanner = new AvalancheRpcScanner({
    dataSource,
    network,
    initialHeight: config.initialHeight,
    sourceId: endpoint.sourceId,
    logger,
  });
  await scanner.registerExtractor(
    new AvalancheRpcObservationExtractor(
      config.addresses.lock,
      dataSource,
      tokens,
      logger.child('avalancheRpcObservationExtractor'),
    ),
  );
  return scanner;
};
