import { env } from '@/env';

import { LOCK_ADDRESSES } from '../../../configs';
import { parseAvalancheAppConfig } from './config';

/** Explicit C-Chain selection shared by transaction and explorer consumers. */
export const avalancheConfig = parseAvalancheAppConfig(
  env.NEXT_PUBLIC_AVALANCHE_CONFIG,
  LOCK_ADDRESSES.avalanche,
);
