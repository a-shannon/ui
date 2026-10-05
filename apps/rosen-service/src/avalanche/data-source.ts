import { AvalancheSafetyState, AvalancheSafetyState1790769600000 } from '@rosen-bridge/evm-scanner';
import type { DataSource } from '@rosen-bridge/extended-typeorm';

/** Add persisted safety metadata before database initialization; never erase existing registrations. */
export const registerAvalancheSafety = (source: DataSource): DataSource => {
  if (source.isInitialized)
    throw new Error('Avalanche safety must be registered before initialization');
  const { entities = [], migrations = [] } = source.options;
  if (!Array.isArray(entities) || !Array.isArray(migrations)) {
    throw new Error('Avalanche safety requires explicit entity and migration lists');
  }
  source.setOptions({
    entities: [...entities, AvalancheSafetyState],
    migrations: [...migrations, AvalancheSafetyState1790769600000],
  });
  return source;
};
