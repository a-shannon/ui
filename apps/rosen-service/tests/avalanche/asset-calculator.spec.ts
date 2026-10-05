import fs from 'node:fs';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AvalancheSafetyState } from '@rosen-bridge/evm-scanner';
import { BridgedAssetEntity, LockedAssetEntity, TokenEntity } from '@rosen-ui/asset-calculator';

import { storedCalculatorFixture } from './assetCalculatorTestUtils';
import { createCalculatorCluster, postgresCalculatorFixture } from './postgresCalculatorTestUtils';
import { finalizedHash } from './testData';

const joe = '0x6e84a6216ea6dacc71ee8e6b0a5b7322eebc0fdd';
describe('AssetCalculator', () => {
  let fixture: Awaited<ReturnType<typeof storedCalculatorFixture>>;
  afterEach(async () => {
    if (fixture?.database.isInitialized) await fixture.database.destroy();
    vi.restoreAllMocks();
  });
  describe('update', () => {
    /**
     * @target AssetCalculator.update persists qualified mainnet JOE accounting
     * @dependencies Actual Service safety, compiled RPC, TokenMap, calculator and SQLite migrations/models
     * @scenario Finalized JOE custody balance is ten billion raw units under an 18-to-9 mapping
     * @expected Stored locked amount is ten wrapped units and native token metadata identifies JOE
     */
    it('persists qualified mainnet JOE accounting', async () => {
      fixture = await storedCalculatorFixture();
      await fixture.asset.update();
      expect(
        await fixture.database
          .getRepository(LockedAssetEntity)
          .findOneBy({ tokenId: joe, address: fixture.config.calculatorAddresses[0] }),
      ).toMatchObject({ amount: 10n });
      expect(
        await fixture.database.getRepository(TokenEntity).findOneBy({ id: joe }),
      ).toMatchObject({
        chain: 'avalanche',
        decimal: 18,
        significantDecimal: 9,
        isNative: false,
        isResident: true,
      });
      expect(
        await fixture.database
          .getRepository(BridgedAssetEntity)
          .findOneBy({ tokenId: joe, chain: 'ergo' }),
      ).toMatchObject({ amount: 1000n, bridgedTokenId: '55'.repeat(32) });
    });
    /**
     * @target AssetCalculator.update preserves the last qualified token balance after %s
     * @dependencies Actual Service persisted-safety/canonical gates and stored SQLite asset
     * @scenario One source input becomes unsafe after the previous successful update
     * @expected Update refuses and the stored JOE locked amount remains unchanged
     */
    it.each(['hold before read', 'hold during read', 'canonical drift'])(
      'preserves the last qualified token balance after %s',
      async (fault) => {
        fixture = await storedCalculatorFixture();
        await fixture.asset.update();
        const repository = fixture.database.getRepository(LockedAssetEntity);
        const before = await repository.findOneBy({ tokenId: joe });
        if (fault === 'hold before read') fixture.state.holdReason = 'operator hold';
        else
          fixture.rpc.send.mockImplementation(async (method) => {
            if (method === 'eth_chainId') return '0xa86a';
            if (method === 'eth_getBalance') return '0x64';
            if (method === 'eth_call') {
              if (fault === 'hold during read') fixture.state.holdReason = 'operator hold';
              return `0x${(10n ** 18n).toString(16).padStart(64, '0')}`;
            }
            if (method === 'eth_getBlockByNumber')
              return {
                number: '0xa',
                hash: fault === 'canonical drift' ? `0x${'cc'.repeat(32)}` : finalizedHash,
              };
            throw new Error('Unexpected stored calculator RPC');
          });
        await expect(fixture.asset.update()).rejects.toThrow();
        expect(await repository.findOneBy({ tokenId: joe })).toEqual(before);
      },
    );
  });
  describe('storeAllTokenSupplies', () => {
    /**
     * @target AssetCalculator.storeAllTokenSupplies derives wrapped token emission from finalized mainnet state
     * @dependencies Actual Service finalized totalSupply/balance readers and inherited emission consumer
     * @scenario A synthetic mapped ERC20 originates on Ethereum and is wrapped on Avalanche
     * @expected Stored Avalanche emission is qualified supply minus custody balance in shared wrapped units
     */
    it('derives wrapped token emission from finalized mainnet state', async () => {
      fixture = await storedCalculatorFixture(true);
      await fixture.asset.update();
      expect(
        await fixture.database
          .getRepository(BridgedAssetEntity)
          .findOneBy({ tokenId: `0x${'78'.repeat(20)}`, chain: 'avalanche' }),
      ).toMatchObject({ amount: 990n, bridgedTokenId: `0x${'56'.repeat(20)}` });
      expect(
        fixture.rpc.send.mock.calls.some(
          ([method, params]) =>
            method === 'eth_call' &&
            Array.isArray(params) &&
            params[0].data === '0x18160ddd' &&
            params[1] === '0xa',
        ),
      ).toEqual(true);
    });
    /**
     * @target AssetCalculator.storeAllTokenSupplies refuses unqualified token issuance before initializing balances
     * @dependencies Actual Service totalSupply safety and empty SQLite models
     * @scenario The wrapped ERC20 supply response has an invalid ABI word
     * @expected No token or locked-asset row is initialized from the rejected startup supply
     */
    it('refuses unqualified token issuance before initializing balances', async () => {
      fixture = await storedCalculatorFixture(true);
      const original = fixture.rpc.send.getMockImplementation()!;
      fixture.rpc.send.mockImplementation(async (method, params) =>
        method === 'eth_call' && Array.isArray(params) && params[0].data === '0x18160ddd'
          ? '0x01'
          : original(method, params),
      );
      await expect(fixture.asset.update()).rejects.toThrow();
      expect(await fixture.database.getRepository(TokenEntity).count()).toEqual(0);
      expect(await fixture.database.getRepository(LockedAssetEntity).count()).toEqual(0);
    });
  });
});

describe.skipIf(process.env.AVALANCHE_SERVICE_POSTGRES_TESTS !== 'true')(
  'AssetCalculator PostgreSQL',
  () => {
    let cluster: Awaited<ReturnType<typeof createCalculatorCluster>>;
    let fixture: Awaited<ReturnType<typeof postgresCalculatorFixture>>;
    beforeAll(async () => {
      cluster = await createCalculatorCluster();
    });
    afterEach(async () => {
      if (fixture?.database.isInitialized) await fixture.database.destroy();
      vi.restoreAllMocks();
    });
    afterAll(() => {
      cluster?.stop();
      if (cluster) expect(fs.existsSync(path.join(cluster.data, 'postmaster.pid'))).toEqual(false);
    });
    describe('update', () => {
      /**
       * @target AssetCalculator.update persists mainnet JOE and wrapped emission in PostgreSQL
       * @dependencies Production Service data-source/migrations, real scanner safety/calculator/RPC and loopback PostgreSQL; unrelated chains and RPC transport are doubles.
       * @scenario Update mapped mainnet JOE and a wrapped ERC20 through real PostgreSQL entities.
       * @expected Locked amount, significant units, counterpart emission and wrapped supply-minus-custody are stored exactly.
       */
      it('persists mainnet JOE and wrapped emission in PostgreSQL', async () => {
        fixture = await postgresCalculatorFixture(cluster);
        await fixture.asset.update();
        expect(
          await fixture.database.getRepository(LockedAssetEntity).findOneBy({ tokenId: joe }),
        ).toMatchObject({ amount: 10n });
        expect(
          await fixture.database.getRepository(TokenEntity).findOneBy({ id: joe }),
        ).toMatchObject({
          chain: 'avalanche',
          decimal: 18,
          significantDecimal: 9,
          isNative: false,
          isResident: true,
        });
        expect(
          await fixture.database
            .getRepository(BridgedAssetEntity)
            .findOneBy({ tokenId: joe, chain: 'ergo' }),
        ).toMatchObject({ amount: 1000n, bridgedTokenId: '55'.repeat(32) });
        expect(
          await fixture.database
            .getRepository(BridgedAssetEntity)
            .findOneBy({ tokenId: `0x${'78'.repeat(20)}`, chain: 'avalanche' }),
        ).toMatchObject({ amount: 990n, bridgedTokenId: `0x${'56'.repeat(20)}` });
      });
      /**
       * @target AssetCalculator.update preserves PostgreSQL rows after %s
       * @dependencies Actual persisted scanner policy, compiled finalized RPC and PostgreSQL entities.
       * @scenario Qualify one update then introduce exactly one hold/canonical fault before or during the next token read.
       * @expected Failed update preserves prior locked, bridged and token rows in a new process snapshot.
       */
      it.each(['hold before read', 'hold during read', 'canonical drift'])(
        'preserves PostgreSQL rows after %s',
        async (fault) => {
          fixture = await postgresCalculatorFixture(cluster);
          await fixture.asset.update();
          const before = cluster.snapshot();
          if (fault === 'hold before read') {
            fixture.state.holdReason = 'operator hold';
            await fixture.database.getRepository(AvalancheSafetyState).save(fixture.state);
          } else {
            const original = fixture.rpc.send.getMockImplementation()!;
            fixture.rpc.send.mockImplementation(async (method, params) => {
              if (fault === 'hold during read' && method === 'eth_call') {
                fixture.state.holdReason = 'operator hold';
                await fixture.database.getRepository(AvalancheSafetyState).save(fixture.state);
              }
              if (fault === 'canonical drift' && method === 'eth_getBlockByNumber')
                return { number: '0xa', hash: `0x${'cc'.repeat(32)}` };
              return original(method, params);
            });
          }
          await expect(fixture.asset.update()).rejects.toThrow();
          const after = cluster.snapshot();
          expect(after.locked).toEqual(before.locked);
          expect(after.bridged).toEqual(before.bridged);
          expect(after.tokens).toEqual(before.tokens);
        },
      );
      /**
       * @target AssetCalculator.update retains PostgreSQL accounting and hold through real restart
       * @dependencies Actual cluster stop/start, fresh Node snapshot process, production entity registrations.
       * @scenario Persist qualified JOE/wrapped accounting and hold, close TypeORM, stop server, restart the owned cluster and read in a new process.
       * @expected Identical accounting and safety state survive; postmaster disappears during stop.
       */
      it('retains PostgreSQL accounting and hold through real restart', async () => {
        fixture = await postgresCalculatorFixture(cluster);
        await fixture.asset.update();
        fixture.state.holdReason = 'operator hold';
        await fixture.database.getRepository(AvalancheSafetyState).save(fixture.state);
        const before = cluster.snapshot();
        await fixture.database.destroy();
        cluster.stop();
        expect(fs.existsSync(path.join(cluster.data, 'postmaster.pid'))).toEqual(false);
        cluster.start();
        expect(cluster.snapshot()).toEqual(before);
      });
    });
    /**
     * @target AssetCalculator.update refuses malformed issuance before PostgreSQL initialization
     * @dependencies Actual finalized supply reader, production migrations/entities and empty dedicated PostgreSQL database.
     * @scenario Supply ABI response is malformed before the first calculator update.
     * @expected No token, locked or bridged accounting row is created.
     */
    it('refuses malformed issuance before PostgreSQL initialization', async () => {
      fixture = await postgresCalculatorFixture(cluster);
      const original = fixture.rpc.send.getMockImplementation()!;
      fixture.rpc.send.mockImplementation(async (method, params) =>
        method === 'eth_call' && Array.isArray(params) && params[0].data === '0x18160ddd'
          ? '0x01'
          : original(method, params),
      );
      await expect(fixture.asset.update()).rejects.toThrow();
      expect(await fixture.database.getRepository(TokenEntity).count()).toEqual(0);
      expect(await fixture.database.getRepository(LockedAssetEntity).count()).toEqual(0);
      expect(await fixture.database.getRepository(BridgedAssetEntity).count()).toEqual(0);
    });
  },
);
