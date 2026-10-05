import { DefaultLogger } from '@rosen-bridge/abstract-logger';

import { createAvalancheScanner } from '../../avalanche/scanner';
import config from '../../configs';
import dataSource from '../../data-source';
import { getTokenMap } from '../../utils';
import { startScanner } from '../scanner-utils';

/** Start optional Avalanche scanning, requiring an initial persisted settled frontier. */
export const startAvalancheScanner = async () => {
  if (!config.avalanche) return undefined;
  const scanner = await createAvalancheScanner(
    config.avalanche,
    dataSource,
    await getTokenMap(),
    DefaultLogger.getInstance().child(import.meta.url),
  );
  await startScanner(scanner, import.meta.url, config.avalanche.intervalMs);
  await scanner.assertUsable();
  return scanner;
};
