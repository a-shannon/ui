import type { AvalancheServiceConfig } from '../../../src/avalanche/config';
import { databaseFixture } from './runtime.mock';

export const startupConfig: { avalanche?: AvalancheServiceConfig } = {};
export const startupDatabase = databaseFixture();
