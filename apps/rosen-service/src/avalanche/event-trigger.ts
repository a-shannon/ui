import { type AbstractLogger, DummyLogger } from '@rosen-bridge/abstract-logger';
import type { DataSource } from '@rosen-bridge/extended-typeorm';
import { ErgoNetworkType } from '@rosen-bridge/scanner-interfaces';
import { EventTriggerExtractor } from '@rosen-bridge/watcher-data-extractor';

import type { AvalancheServiceConfig } from './config';

/** Construct the Avalanche event-trigger reader on Ergo using operator-supplied Rosen identities. */
export const createAvalancheEventTriggerExtractor = (
  config: AvalancheServiceConfig,
  dataSource: DataSource,
  ergoExplorerUrl: string,
  logger: AbstractLogger = new DummyLogger(),
) =>
  new EventTriggerExtractor(
    'avalanche-extractor',
    dataSource,
    ErgoNetworkType.Explorer,
    ergoExplorerUrl,
    config.addresses.eventTrigger,
    config.tokens.rwt,
    config.addresses.permit,
    config.addresses.fraud,
    logger,
  );
