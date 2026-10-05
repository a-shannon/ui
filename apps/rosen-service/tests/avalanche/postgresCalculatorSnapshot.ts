import { AvalancheSafetyState } from '@rosen-bridge/evm-scanner';
import { BridgedAssetEntity, LockedAssetEntity, TokenEntity } from '@rosen-ui/asset-calculator';
import { getDataSource } from '@rosen-ui/data-source';

import { registerAvalancheSafety } from '../../src/avalanche/data-source';

/** Snapshot only the explicit test database; initialization never creates or migrates rows. */
const snapshot = async () => {
  const url = process.env.AVALANCHE_POSTGRES_TEST_URL;
  if (!url || new URL(url).hostname !== '127.0.0.1' || new URL(url).pathname !== '/calculator_test')
    throw new Error('Dedicated loopback calculator test database is required');
  const database = registerAvalancheSafety(getDataSource(url, false, false));
  try {
    await database.initialize();
    const state = await database
      .getRepository(AvalancheSafetyState)
      .findOneBy({ scanner: 'avalanche' });
    const tokens = await database.getRepository(TokenEntity).find({ order: { id: 'ASC' } });
    const locked = await database
      .getRepository(LockedAssetEntity)
      .find({ order: { tokenId: 'ASC', address: 'ASC' } });
    const bridged = await database
      .getRepository(BridgedAssetEntity)
      .find({ order: { tokenId: 'ASC', chain: 'ASC' } });
    process.stdout.write(
      JSON.stringify({ state, tokens, locked, bridged }, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    );
  } finally {
    if (database.isInitialized) await database.destroy();
  }
};
await snapshot();
