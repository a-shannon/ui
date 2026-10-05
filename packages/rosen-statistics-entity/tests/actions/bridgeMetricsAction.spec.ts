import { beforeEach, describe, expect, it } from 'vitest';

import { type AbstractLogger, DummyLogger } from '@rosen-bridge/abstract-logger';
import { BlockEntity } from '@rosen-bridge/abstract-scanner';
import { DataSource, type Repository } from '@rosen-bridge/extended-typeorm';
import { EventTriggerEntity } from '@rosen-bridge/watcher-data-extractor';
import {
  LockedAssetEntity as AggregatorLockedAssetEntity,
  TokenEntity as AggregatorTokenEntity,
} from '@rosen-ui/asset-aggregator';
import { LockedAssetEntity, TokenEntity } from '@rosen-ui/asset-calculator';

import {
  BridgedAmountEntity,
  BridgeFeeEntity,
  BridgeMetricsAction,
  METRIC_KEYS,
  MetricEntity,
} from '../../lib';
import { bridgeMetricsActionTestData } from '../testData';
import { createDatabase } from '../utils';

describe('BridgeMetricsAction', () => {
  let dataSource: DataSource;
  let eventTriggerRepo: Repository<EventTriggerEntity>;
  let blockRepo: Repository<BlockEntity>;
  let bridgeFeeRepo: Repository<BridgeFeeEntity>;
  let bridgeAmountRepo: Repository<BridgedAmountEntity>;
  let tokenRepo: Repository<TokenEntity>;
  let metricRepo: Repository<MetricEntity>;
  let logger: AbstractLogger;
  let action: BridgeMetricsAction;

  beforeEach(async () => {
    dataSource = await createDatabase();
    eventTriggerRepo = dataSource.getRepository(EventTriggerEntity);
    blockRepo = dataSource.getRepository(BlockEntity);
    bridgeFeeRepo = dataSource.getRepository(BridgeFeeEntity);
    bridgeAmountRepo = dataSource.getRepository(BridgedAmountEntity);
    tokenRepo = dataSource.getRepository(TokenEntity);
    metricRepo = dataSource.getRepository(MetricEntity);
    logger = new DummyLogger();

    await eventTriggerRepo.clear();
    await blockRepo.clear();
    await bridgeFeeRepo.clear();
    await bridgeAmountRepo.clear();
    await metricRepo.clear();

    action = new BridgeMetricsAction(dataSource, logger);
  });

  describe('getLastBridgeFeeRecord', () => {
    /**
     * @target getLastBridgeFeeRecord should return undefined when no records exist in BridgeFeeEntity
     * @dependencies
     * - database
     * @scenario
     * - No records in BridgeFeeEntity table
     * - Call getLastBridgeFeeRecord
     * @expected
     * - Returns undefined
     */
    it('should return undefined when no records exist in BridgeFeeEntity', async () => {
      const lastProcessedRecord = await action.getLastBridgeFeeRecord();

      expect(lastProcessedRecord).toBeUndefined();
    });

    /**
     * @target getLastBridgeFeeRecord should return the record with the highest lastProcessedHeight
     * @dependencies
     * - database
     * @scenario
     * - Insert multiple BridgeFeeEntity records with different lastProcessedHeight values
     * - Call getLastBridgeFeeRecord
     * @expected
     * - Returns the record with the highest lastProcessedHeight
     */
    it('should return the record with the highest lastProcessedHeight', async () => {
      const testData = bridgeMetricsActionTestData.getLastProcessedHeightMultipleRecords;

      await bridgeFeeRepo.insert(testData.bridgeFeeRepo);

      const lastProcessedRecord = await action.getLastBridgeFeeRecord();

      expect(lastProcessedRecord).toEqual(testData.expectedRecord);
    });
  });

  describe('getLastBridgeAmountRecord', () => {
    /**
     * @target getLastBridgeAmountRecord should return undefined when no records exist in BridgeAmountEntity
     * @dependencies
     * - database
     * @scenario
     * - No records in BridgeAmountEntity table
     * - Call getLastBridgeAmountRecord
     * @expected
     * - Returns undefined
     */
    it('should return undefined when no records exist in BridgeAmountEntity', async () => {
      const lastProcessedRecord = await action.getLastBridgeAmountRecord();

      expect(lastProcessedRecord).toBeUndefined();
    });

    /**
     * @target getLastBridgeAmountRecord should return the record with the highest lastProcessedHeight
     * @dependencies
     * - database
     * @scenario
     * - Insert multiple BridgeAmountEntity records with different lastProcessedHeight values
     * - Call getLastBridgeAmountRecord
     * @expected
     * - Returns the record with the highest lastProcessedHeight
     */
    it('should return the record with the highest lastProcessedHeight', async () => {
      const testData = bridgeMetricsActionTestData.getLastBridgeAmountWithMultipleRecords;

      await bridgeAmountRepo.insert(testData.bridgeAmountRepo);

      const lastProcessedRecord = await action.getLastBridgeAmountRecord();

      expect(lastProcessedRecord).toEqual(testData.expectedRecord);
    });
  });

  describe('getFirstEventTimestamp', () => {
    /**
     * @target getFirstEventTimestamp should return undefined when no events exist
     * @dependencies
     * - database
     * @scenario
     * - No events in database
     * - Call getFirstEventTimestamp
     * @expected
     * - Returns undefined
     */
    it('should return undefined when no events exist', async () => {
      const timestamp = await action.getFirstEventTimestamp();
      expect(timestamp).toBeUndefined();
    });

    /**
     * @target getFirstEventTimestamp should return the earliest event timestamp
     * @dependencies
     * - database
     * @scenario
     * - Insert multiple events with different timestamps
     * - Call getFirstEventTimestamp
     * @expected
     * - Returns the earliest timestamp
     */
    it('should return the earliest event timestamp', async () => {
      const testData = bridgeMetricsActionTestData.getFirstEventTimestampMultipleEvents;

      await blockRepo.insert(testData.blockRepo);
      await eventTriggerRepo.insert(testData.eventTriggerRepo);

      const timestamp = await action.getFirstEventTimestamp();
      expect(timestamp).toEqual(testData.expectedTimestamp);
    });
  });

  describe('getEventsInRange', () => {
    /**
     * Builds the migrated range fixture with Service2's genuine token/locked-asset pair.
     * Preserves their declared relation and the fixture's remaining entities and migrations.
     * @param entityPrefix - Optional table prefix; uses synchronized entity metadata when present.
     * @returns An initialized local SQLite DataSource owned by the calling test.
     */
    const createAggregatorDatabase = async (entityPrefix = ''): Promise<DataSource> => {
      if (!Array.isArray(dataSource.options.entities)) {
        throw new Error('Range fixture requires an explicit entity array');
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
     * Inserts the established nonempty range fixture using its registered token table.
     * @param source - Local migrated DataSource with either genuine TokenEntity family.
     * @returns A promise resolving after block, event and token rows are inserted.
     */
    const insertRangeFixture = async (source: DataSource): Promise<void> => {
      const fixture = bridgeMetricsActionTestData.getEventsInRangeMultipleEvents;
      await source.getRepository(BlockEntity).insert(fixture.blockRepo);
      await source.getRepository(EventTriggerEntity).insert(fixture.eventTriggerRepo);
      await source.getRepository<TokenEntity>('TokenEntity').insert(fixture.tokenRepo);
    };

    /**
     * @target getEventsInRange should fetch bridge amount and bridge fee with block timestamps and token decimals
     * @dependencies
     * - database
     * @scenario
     * - Insert blocks with timestamps and date components
     * - Insert tokens with decimals
     * - Insert successful events with spend heights in range
     * - Call getEventsInRange with startTs and endTs
     * @expected
     * - Returns events with correct bridge data, block metadata, and token decimals
     * - Does not include events outside timestamp range
     * - Does not include events with non-successful status
     */
    it('should fetch bridge amount and bridge fee with block timestamps and token decimals', async () => {
      const testData = bridgeMetricsActionTestData.getEventsInRangeMultipleEvents;

      await blockRepo.insert(testData.blockRepo);
      await eventTriggerRepo.insert(testData.eventTriggerRepo);
      await tokenRepo.insert(testData.tokenRepo);

      const events = await action.getEventsInRange(testData.startTs, testData.endTs);

      expect(events).toEqual(testData.expectedEvents);
    });

    /**
     * @target getEventsInRange should handle missing block data gracefully
     * @dependencies
     * - database
     * @scenario
     * - Insert events with spendBlock that don't exist in blockRepo
     * - Insert events with sourceChainHeight that don't have corresponding block
     * - Call getEventsInRange
     * @expected
     * - Returns events with available data
     */
    it('should handle missing block data gracefully', async () => {
      const testData = bridgeMetricsActionTestData.getEventsInRangeMissingBlocks;

      await blockRepo.insert(testData.blockRepo);
      await eventTriggerRepo.insert(testData.eventTriggerRepo);
      await tokenRepo.insert(testData.tokenRepo);

      const events = await action.getEventsInRange(testData.startTs, testData.endTs);

      expect(events).toEqual(testData.expectedEvents);
    });

    /**
     * @target getEventsInRange should return empty array when no events in range
     * @dependencies
     * - database
     * @scenario
     * - Insert events with timestamps outside range
     * - Call getEventsInRange
     * @expected
     * - Returns empty array
     */
    it('should return empty array when no events in range', async () => {
      const testData = bridgeMetricsActionTestData.getEventsInRangeNoEvents;

      await blockRepo.insert(testData.blockRepo);
      await eventTriggerRepo.insert(testData.eventTriggerRepo);

      const events = await action.getEventsInRange(testData.startTs, testData.endTs);

      expect(events).toHaveLength(0);
    });

    /**
     * @target BridgeMetricsAction.getEventsInRange should join the registered calculator token table
     * @dependencies Genuine calculator TokenEntity, migrated SQLite and the existing range fixture.
     * @scenario Insert successful events, three dated blocks and tokens with 8 and 6 significant decimals.
     * @expected The calculator constructor remains registered and both in-range events retain their decimals.
     */
    it('should join the registered calculator token table', async () => {
      const fixture = bridgeMetricsActionTestData.getEventsInRangeMultipleEvents;
      await insertRangeFixture(dataSource);

      expect(dataSource.getMetadata('token_entity').target).toBe(TokenEntity);
      expect(dataSource.hasMetadata(AggregatorTokenEntity)).toEqual(false);
      expect(await action.getEventsInRange(fixture.startTs, fixture.endTs)).toEqual(
        fixture.expectedEvents,
      );
    });

    /**
     * @target BridgeMetricsAction.getEventsInRange should join the registered aggregator token table
     * @dependencies Genuine aggregator TokenEntity, original migrations and the existing range fixture.
     * @scenario Register Service2's token/locked-asset pair, retaining its relation and the range fixture.
     * @expected Two populated events retain their amounts, blocks and decimals without registering the calculator class.
     */
    it('should join the registered aggregator token table', async () => {
      const source = await createAggregatorDatabase();
      try {
        const fixture = bridgeMetricsActionTestData.getEventsInRangeMultipleEvents;
        await insertRangeFixture(source);

        expect(source.getMetadata('token_entity').target).toBe(AggregatorTokenEntity);
        expect(source.hasMetadata(TokenEntity)).toEqual(false);
        expect(
          await new BridgeMetricsAction(source).getEventsInRange(fixture.startTs, fixture.endTs),
        ).toEqual(fixture.expectedEvents);
      } finally {
        await source.destroy();
      }
    });

    /**
     * @target BridgeMetricsAction.getEventsInRange should omit an event without its joined token
     * @dependencies Genuine aggregator token registry and populated local SQLite range fixture.
     * @scenario Delete only token-1 after inserting both successful in-range events and their blocks.
     * @expected The token-1 event is absent while the unchanged token-2 event and its decimal remain.
     */
    it('should omit an event without its joined token', async () => {
      const source = await createAggregatorDatabase();
      try {
        const fixture = bridgeMetricsActionTestData.getEventsInRangeMultipleEvents;
        await insertRangeFixture(source);
        await source.getRepository(AggregatorTokenEntity).delete('token-1');

        expect(
          await new BridgeMetricsAction(source).getEventsInRange(fixture.startTs, fixture.endTs),
        ).toEqual(fixture.expectedEvents.slice(1));
      } finally {
        await source.destroy();
      }
    });

    /**
     * @target BridgeMetricsAction.getEventsInRange should omit an event with a mismatched source token identifier
     * @dependencies Genuine aggregator token registry, actual event repository and migrated SQLite.
     * @scenario Change only event1's sourceChainTokenId to an identifier absent from the token table.
     * @expected The changed event cannot join; the second event remains with its original amount and decimal.
     */
    it('should omit an event with a mismatched source token identifier', async () => {
      const source = await createAggregatorDatabase();
      try {
        const fixture = bridgeMetricsActionTestData.getEventsInRangeMultipleEvents;
        await insertRangeFixture(source);
        await source
          .getRepository(EventTriggerEntity)
          .update({ eventId: 'event1' }, { sourceChainTokenId: 'missing-token' });

        expect(
          await new BridgeMetricsAction(source).getEventsInRange(fixture.startTs, fixture.endTs),
        ).toEqual(fixture.expectedEvents.slice(1));
      } finally {
        await source.destroy();
      }
    });

    /**
     * @target BridgeMetricsAction.getEventsInRange should keep the end timestamp exclusive for aggregator tokens
     * @dependencies Genuine aggregator token registry and nonempty local SQLite event, block and token rows.
     * @scenario Set endTs exactly to the second successful event's block timestamp.
     * @expected The event at endTs is excluded and the first successful in-range event remains.
     */
    it('should keep the end timestamp exclusive for aggregator tokens', async () => {
      const source = await createAggregatorDatabase();
      try {
        const fixture = bridgeMetricsActionTestData.getEventsInRangeMultipleEvents;
        await insertRangeFixture(source);

        expect(
          await new BridgeMetricsAction(source).getEventsInRange(
            fixture.startTs,
            fixture.expectedEvents[1].timestamp,
          ),
        ).toEqual(fixture.expectedEvents.slice(0, 1));
      } finally {
        await source.destroy();
      }
    });

    /**
     * @target BridgeMetricsAction.getEventsInRange should omit an unsuccessful aggregator event
     * @dependencies Genuine aggregator token registry, event repository and populated local SQLite fixture.
     * @scenario Change only event1's result from successful to fraud while preserving its block and token.
     * @expected The unsuccessful event is excluded while the second successful event remains unchanged.
     */
    it('should omit an unsuccessful aggregator event', async () => {
      const source = await createAggregatorDatabase();
      try {
        const fixture = bridgeMetricsActionTestData.getEventsInRangeMultipleEvents;
        await insertRangeFixture(source);
        await source
          .getRepository(EventTriggerEntity)
          .update({ eventId: 'event1' }, { result: 'fraud' });

        expect(
          await new BridgeMetricsAction(source).getEventsInRange(fixture.startTs, fixture.endTs),
        ).toEqual(fixture.expectedEvents.slice(1));
      } finally {
        await source.destroy();
      }
    });

    /**
     * @target BridgeMetricsAction.getEventsInRange should preserve a configured token table prefix
     * @dependencies Genuine aggregator entity pair and synchronized prefixed SQLite metadata.
     * @scenario Populate the established successful range fixture with entityPrefix set to fixture_.
     * @expected The registered prefixed token table joins both events with their original decimals.
     */
    it('should preserve a configured token table prefix', async () => {
      const source = await createAggregatorDatabase('fixture_');
      try {
        const fixture = bridgeMetricsActionTestData.getEventsInRangeMultipleEvents;
        await insertRangeFixture(source);

        expect(source.getMetadata('TokenEntity').tableName).toEqual('fixture_token_entity');
        expect(
          await new BridgeMetricsAction(source).getEventsInRange(fixture.startTs, fixture.endTs),
        ).toEqual(fixture.expectedEvents);
      } finally {
        await source.destroy();
      }
    });
  });

  describe('saveBridgeFees', () => {
    /**
     * @target saveBridgeFees should create new bridge fee records and update total metric
     * @dependencies
     * - database
     * @scenario
     * - No existing BridgeFeeEntity or MetricEntity records
     * - Call saveBridgeFees with 2 aggregated bridge fee groups and totalCount as string
     * @expected
     * - Creates 2 BridgeFeeEntity records with correct amounts and metadata
     * - Creates MetricEntity record with TOTAL_BRIDGE_FEES_USD as string
     * - All operations succeed in same transaction
     */
    it('should create new bridge fee records and update total metric', async () => {
      const testData = bridgeMetricsActionTestData.saveBridgeFeesNewGroups;

      await action.saveBridgeFees(testData.aggregatedBridgeFees, testData.totalCount);

      const bridgeFees = await bridgeFeeRepo.find({
        select: ['fromChain', 'amount', 'day', 'week', 'month', 'year', 'lastProcessedHeight'],
      });

      expect(bridgeFees).toHaveLength(testData.expectedBridgeFees.length);
      expect(bridgeFees).toEqual(testData.expectedBridgeFees);

      const metric = await metricRepo.findOne({
        where: { key: METRIC_KEYS.TOTAL_BRIDGE_FEES_USD },
      });
      expect(metric?.value).toEqual(testData.expectedMetricValue);
      expect(metric?.updatedAt).toBeDefined();
    });

    /**
     * @target saveBridgeFees should replace existing bridge fee records with new values
     * @dependencies
     * - database
     * @scenario
     * - Insert existing BridgeFeeEntity record
     * - Insert existing MetricEntity with TOTAL_BRIDGE_FEES_USD = '10'
     * - Call saveBridgeFees with updated bridge fee data and totalCount = '15'
     * @expected
     * - Creates a new BridgeFeeEntity records with correct amounts and metadata
     * - MetricEntity is updated to '15'
     */
    it('should replace existing bridge fee records with new values', async () => {
      const testData = bridgeMetricsActionTestData.saveBridgeFeesUpdateExisting;

      await bridgeFeeRepo.insert(testData.existingBridgeFees);
      await metricRepo.insert(testData.existingMetric);

      await action.saveBridgeFees(testData.aggregatedBridgeFees, testData.totalCount);

      const bridgeFees = await bridgeFeeRepo.find({
        select: ['fromChain', 'amount', 'day', 'week', 'month', 'year', 'lastProcessedHeight'],
      });

      expect(bridgeFees).toHaveLength(testData.expectedBridgeFees.length);
      expect(bridgeFees).toEqual(testData.expectedBridgeFees);

      const metric = await metricRepo.findOne({
        where: { key: METRIC_KEYS.TOTAL_BRIDGE_FEES_USD },
      });
      expect(metric?.value).toEqual(testData.expectedMetricValue);
    });

    /**
     * @target saveBridgeFees should handle multiple groups with different dates
     * @dependencies
     * - database
     * @scenario
     * - Call saveBridgeFees with bridge fee groups from different dates
     * @expected
     * - All groups are created correctly with their respective date components
     */
    it('should handle multiple groups with different dates', async () => {
      const testData = bridgeMetricsActionTestData.saveBridgeFeesDifferentDates;

      await action.saveBridgeFees(testData.aggregatedBridgeFees, testData.totalCount);

      const bridgeFees = await bridgeFeeRepo.find({
        select: ['fromChain', 'amount', 'day', 'week', 'month', 'year', 'lastProcessedHeight'],
      });

      expect(bridgeFees).toHaveLength(testData.expectedBridgeFees.length);
      expect(bridgeFees).toEqual(testData.expectedBridgeFees);
    });
  });

  describe('saveBridgeAmount', () => {
    /**
     * @target saveBridgeAmount should create new bridge amount records and update total metric
     * @dependencies
     * - database
     * @scenario
     * - No existing BridgeAmountEntity or MetricEntity records
     * - Call saveBridgeFees with 2 aggregated bridge amount groups and totalCount as string
     * @expected
     * - Creates 2 BridgeAmountEntity records with correct amounts and metadata
     * - Creates MetricEntity record with TOTAL_BRIDGE_AMOUNT_USD as string
     * - All operations succeed in same transaction
     */
    it('should create new bridge amount records and update total metric', async () => {
      const testData = bridgeMetricsActionTestData.saveBridgeAmountNewGroups;

      await action.saveBridgeAmount(testData.aggregatedBridgeAmount, testData.totalCount);

      const bridgeAmount = await bridgeAmountRepo.find({
        select: ['fromChain', 'amount', 'day', 'week', 'month', 'year', 'lastProcessedHeight'],
      });

      expect(bridgeAmount).toHaveLength(testData.expectedBridgeAmount.length);
      expect(bridgeAmount).toEqual(testData.expectedBridgeAmount);

      const metric = await metricRepo.findOne({
        where: { key: METRIC_KEYS.TOTAL_BRIDGE_AMOUNT_USD },
      });
      expect(metric?.value).toEqual(testData.expectedMetricValue);
      expect(metric?.updatedAt).toBeDefined();
    });

    /**
     * @target saveBridgeAmount should replace existing bridge amount records with new values
     * @dependencies
     * - database
     * @scenario
     * - Insert existing BridgeAmountEntity record
     * - Insert existing MetricEntity with TOTAL_BRIDGE_AMOUNT_USD = '10'
     * - Call saveBridgeAMount with updated bridge amount data and totalCount = '25.25'
     * @expected
     * - Creates a new BridgeAmountEntity records with correct amounts and metadata
     * - MetricEntity is updated to '25.25'
     */
    it('should replace existing bridge amount records with new values', async () => {
      const testData = bridgeMetricsActionTestData.saveBridgeAmountUpdateExisting;

      await bridgeAmountRepo.insert(testData.existingBridgeAmount);
      await metricRepo.insert(testData.existingMetric);

      await action.saveBridgeAmount(testData.aggregatedBridgeAmount, testData.totalCount);

      const bridgeAmount = await bridgeAmountRepo.find({
        select: ['fromChain', 'amount', 'day', 'week', 'month', 'year', 'lastProcessedHeight'],
      });

      expect(bridgeAmount).toHaveLength(testData.expectedBridgeAmount.length);
      expect(bridgeAmount).toEqual(testData.expectedBridgeAmount);

      const metric = await metricRepo.findOne({
        where: { key: METRIC_KEYS.TOTAL_BRIDGE_AMOUNT_USD },
      });
      expect(metric?.value).toEqual(testData.expectedMetricValue);
    });

    /**
     * @target saveBridgeAmount should handle multiple groups with different dates
     * @dependencies
     * - database
     * @scenario
     * - Call saveBridgeAmount with bridge amount groups from different dates
     * @expected
     * - All groups are created correctly with their respective date components
     */
    it('should handle multiple groups with different dates', async () => {
      const testData = bridgeMetricsActionTestData.saveBridgeAmountDifferentDates;

      await action.saveBridgeAmount(testData.aggregatedBridgeAmount, testData.totalCount);

      const bridgeAmount = await bridgeAmountRepo.find({
        select: ['fromChain', 'amount', 'day', 'week', 'month', 'year', 'lastProcessedHeight'],
      });

      expect(bridgeAmount).toHaveLength(testData.expectedBridgeAmount.length);
      expect(bridgeAmount).toEqual(testData.expectedBridgeAmount);
    });
  });
});
