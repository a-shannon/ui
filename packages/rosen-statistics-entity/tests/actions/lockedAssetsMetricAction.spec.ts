import { beforeEach, describe, expect, it } from 'vitest';

import { type AbstractLogger, DummyLogger } from '@rosen-bridge/abstract-logger';
import { DataSource, type Repository } from '@rosen-bridge/extended-typeorm';
import {
  LockedAssetEntity as AggregatorLockedAssetEntity,
  TokenEntity as AggregatorTokenEntity,
} from '@rosen-ui/asset-aggregator';
import { LockedAssetEntity, TokenEntity } from '@rosen-ui/asset-calculator';

import { LockedAssetsMetricAction } from '../../lib';
import { lockedAssetsMetricActionTestData } from '../testData';
import { createDatabase } from '../utils';

describe('LockedAssetsMetricAction', () => {
  let dataSource: DataSource;
  let lockedAssetRepo: Repository<LockedAssetEntity>;
  let tokenRepo: Repository<TokenEntity>;
  let logger: AbstractLogger;
  let action: LockedAssetsMetricAction;

  beforeEach(async () => {
    dataSource = await createDatabase();
    lockedAssetRepo = dataSource.getRepository(LockedAssetEntity);
    tokenRepo = dataSource.getRepository(TokenEntity);
    logger = new DummyLogger();

    await lockedAssetRepo.clear();
    await tokenRepo.clear();

    action = new LockedAssetsMetricAction(dataSource, logger);
  });

  describe('getLockedAssets', () => {
    /**
     * Builds the migrated fixture with Service2's genuine locked-asset/token pair.
     * @param entityPrefix - Optional table prefix; uses synchronized entity metadata when present.
     * @returns An initialized local SQLite DataSource owned by the calling test.
     */
    const createAggregatorDatabase = async (entityPrefix = ''): Promise<DataSource> => {
      if (!Array.isArray(dataSource.options.entities)) {
        throw new Error('Locked-asset fixture requires an explicit entity array');
      }
      const source = new DataSource({
        ...dataSource.options,
        ...(entityPrefix ? { entityPrefix, synchronize: true, migrations: [] } : {}),
        entities: dataSource.options.entities.map((entity) => {
          if (entity === TokenEntity) return AggregatorTokenEntity;
          if (entity === LockedAssetEntity) return AggregatorLockedAssetEntity;
          return entity;
        }),
      });
      await source.initialize();
      await source.runMigrations();
      return source;
    };

    /**
     * Inserts a real token relation and an exactly representable SQLite bigint above 2^53.
     * @param source - Local migrated DataSource with a coherent genuine entity pair.
     * @returns A promise resolving after the token and locked-asset rows are inserted.
     */
    const insertLargeLockedAsset = async (source: DataSource): Promise<void> => {
      await source.getRepository<TokenEntity>('TokenEntity').insert({
        id: 'precision-token',
        name: 'Synthetic precision token',
        decimal: 18,
        significantDecimal: 6,
        isNative: true,
        chain: 'ergo',
        ergoSideTokenId: 'synthetic-ergo-token',
        isResident: true,
      });
      await source.getRepository<LockedAssetEntity>('LockedAssetEntity').insert({
        tokenId: 'precision-token',
        amount: 9007199254740994n,
        address: 'synthetic-lock-address',
      });
    };

    /**
     * @target getLockedAssets should return empty array when no locked assets exist
     * @dependencies
     * - database
     * @scenario
     * - No records in LockedAssetEntity table
     * - Call getLockedAssets
     * @expected
     * - Returns empty array
     */
    it('should return empty array when no locked assets exist', async () => {
      const result = await action.getLockedAssets();

      expect(result).toHaveLength(0);
    });

    /**
     * @target getLockedAssets should return correct locked assets tokenIds, amounts, and significantDecimals
     * @dependencies
     * - database
     * @scenario
     * - Insert multiple TokenEntity records with different significantDecimals
     * - Insert multiple LockedAssetEntity records for each token
     * - Call getLockedAssets
     * @expected
     * - Returns array with correct tokenIds, amounts, and significantDecimals from TokenEntity
     */
    it('should return correct locked assets tokenIds, amounts, and significantDecimals', async () => {
      const testData = lockedAssetsMetricActionTestData.getLockedAssetsMultipleTokens;

      await tokenRepo.insert(testData.tokens);
      await lockedAssetRepo.insert(testData.lockedAssets);

      const result = await action.getLockedAssets();

      expect(result).toHaveLength(testData.expectedResults.length);
      expect(result).toEqual(testData.expectedResults);
    });

    /**
     * @target LockedAssetsMetricAction.getLockedAssets should preserve a calculator bigint and significant decimal
     * @dependencies Genuine calculator entities, BigIntValueTransformer and migrated SQLite.
     * @scenario Insert amount 9007199254740994n and its token with decimal 18 but significantDecimal 6.
     * @expected The amount remains bigint and the metric selects significantDecimal 6 through the real relation.
     */
    it('should preserve a calculator bigint and significant decimal', async () => {
      await insertLargeLockedAsset(dataSource);

      expect(dataSource.getMetadata('locked_asset_entity').target).toBe(LockedAssetEntity);
      expect(await action.getLockedAssets()).toEqual([
        { tokenId: 'precision-token', amount: 9007199254740994n, significantDecimal: 6 },
      ]);
    });

    /**
     * @target LockedAssetsMetricAction.getLockedAssets should preserve an aggregator bigint and significant decimal
     * @dependencies Genuine aggregator entity pair, BigIntValueTransformer and migrated SQLite.
     * @scenario Register Service2's coherent entity pair and insert a related token and locked amount above 2^53.
     * @expected The calculator class remains unregistered while the bigint amount and significantDecimal 6 are returned.
     */
    it('should preserve an aggregator bigint and significant decimal', async () => {
      const source = await createAggregatorDatabase();
      try {
        await insertLargeLockedAsset(source);

        expect(source.getMetadata('locked_asset_entity').target).toBe(AggregatorLockedAssetEntity);
        expect(source.getMetadata('token_entity').target).toBe(AggregatorTokenEntity);
        expect(source.hasMetadata(LockedAssetEntity)).toEqual(false);
        expect(await new LockedAssetsMetricAction(source).getLockedAssets()).toEqual([
          { tokenId: 'precision-token', amount: 9007199254740994n, significantDecimal: 6 },
        ]);
      } finally {
        await source.destroy();
      }
    });

    /**
     * @target LockedAssetsMetricAction.getLockedAssets should return an empty aggregator metric
     * @dependencies Genuine aggregator entity pair and its registered local SQLite repositories.
     * @scenario Query a migrated aggregator fixture without inserting any locked assets or tokens.
     * @expected The actual repository relation query returns an empty array without requiring calculator metadata.
     */
    it('should return an empty aggregator metric', async () => {
      const source = await createAggregatorDatabase();
      try {
        expect(await new LockedAssetsMetricAction(source).getLockedAssets()).toEqual([]);
      } finally {
        await source.destroy();
      }
    });

    /**
     * @target LockedAssetsMetricAction.getLockedAssets should enforce the registered token foreign key
     * @dependencies Genuine aggregator relation metadata, real SQLite constraints and registered repositories.
     * @scenario Insert a locked asset whose tokenId has no row in the otherwise healthy token table.
     * @expected SQLite rejects the invalid relation and the locked metric remains empty.
     */
    it('should enforce the registered token foreign key', async () => {
      const source = await createAggregatorDatabase();
      try {
        await expect(
          source.getRepository(AggregatorLockedAssetEntity).insert({
            tokenId: 'missing-token',
            amount: 7n,
            address: 'synthetic-lock-address',
          }),
        ).rejects.toThrow('FOREIGN KEY constraint failed');
        expect(await new LockedAssetsMetricAction(source).getLockedAssets()).toEqual([]);
      } finally {
        await source.destroy();
      }
    });

    /**
     * @target LockedAssetsMetricAction.getLockedAssets should preserve a configured locked table prefix
     * @dependencies Genuine aggregator relation metadata and synchronized prefixed local SQLite tables.
     * @scenario Insert a related token and bigint amount with entityPrefix set to fixture_.
     * @expected The prefixed registered locked-asset repository returns the amount and token significant decimal.
     */
    it('should preserve a configured locked table prefix', async () => {
      const source = await createAggregatorDatabase('fixture_');
      try {
        await insertLargeLockedAsset(source);

        expect(source.getMetadata('LockedAssetEntity').tableName).toEqual(
          'fixture_locked_asset_entity',
        );
        expect(await new LockedAssetsMetricAction(source).getLockedAssets()).toEqual([
          { tokenId: 'precision-token', amount: 9007199254740994n, significantDecimal: 6 },
        ]);
      } finally {
        await source.destroy();
      }
    });
  });
});
