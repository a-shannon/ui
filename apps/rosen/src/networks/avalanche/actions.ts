import type { TokenMap } from '@rosen-bridge/tokens';
import type { AvalancheProvider } from '@rosen-network/avalanche';
import { createAvalancheActions } from '@rosen-network/avalanche/server';

import type { AvalancheAppConfig } from './config';

/** Inject application configuration and readers into the network-owned lock producers. */
export const createAvalancheAppActions = (
  config: AvalancheAppConfig,
  provider: AvalancheProvider,
  getTokenMap: () => Promise<TokenMap>,
) => createAvalancheActions(config, provider, getTokenMap);
