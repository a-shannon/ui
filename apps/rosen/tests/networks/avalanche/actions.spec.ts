import { describe, expect, it } from 'vitest';

import type { Network } from '@rosen-ui/types';

import { avax, destination, lock, sender } from './testData';
import { createFixture } from './testUtils';

describe('createAvalancheAppActions', () => {
  describe('generateTxParameters', () => {
    /**
     * @target generateTxParameters should preserve the real producer-to-network transaction
     * @dependencies real TokenMap, EVM lock encoder, network facade and qualified provider
     * @scenario ten wrapped8 units cover fees two plus three on explicit Fuji
     * @expected exact custody, sender, metadata, native18 value and chain ID survive composition
     */
    it('should preserve the real producer-to-network transaction', async () => {
      const { network, data } = await createFixture();
      expect(data).toEqual(`030000000000000002000000000000000314${'33'.repeat(20)}`);
      expect(
        await network.generateTxParameters('avax', lock, sender, 10n, data, avax, 'avalanche'),
      ).toEqual({
        to: lock,
        from: sender,
        data: `0x${data}`,
        value: '0x174876e800',
        chainId: '0xa869',
      });
    });

    /**
     * @target generateTxParameters should reject mismatched actual native decimals
     * @dependencies real TokenMap update API and EVM transaction producer
     * @scenario change only the stored AVAX decimals while the supplied token remains native18
     * @expected server action refuses the actual map before exposing a transaction
     */
    it('should reject mismatched actual native decimals', async () => {
      const { map, actions, data } = await createFixture();
      const raw = map.getRawConfig();
      raw[0].avalanche.decimals = 9;
      await map.updateConfigByJson(raw);
      await expect(
        actions.generateTxParameters('avax', lock, sender, 10n, data, avax, 'avalanche'),
      ).rejects.toThrow();
    });

    /**
     * @target generateTxParameters should reject unfunded amount %s
     * @dependencies real EVM metadata with fees two plus three
     * @scenario independently set amount below or equal to total fees
     * @expected no invalid native lock is returned by the server action
     */
    it.each([0n, 4n, 5n])('should reject unfunded amount %s', async (amount) => {
      const { actions, data } = await createFixture();
      await expect(
        actions.generateTxParameters('avax', lock, sender, amount, data, avax, 'avalanche'),
      ).rejects.toThrow();
    });

    /**
     * @target generateTxParameters should reject isolated %s field
     * @dependencies actual TokenMap and encoder
     * @scenario independently alter the native ID, custody, metadata or source chain
     * @expected the server boundary rejects without relying on the wallet to repair it
     */
    it.each(['token', 'custody', 'metadata', 'source'] as const)(
      'should reject isolated %s field',
      async (field) => {
        const { actions, data } = await createFixture();
        await expect(
          actions.generateTxParameters(
            field === 'token' ? 'other' : 'avax',
            field === 'custody' ? destination : lock,
            sender,
            10n,
            field === 'metadata' ? data.slice(2) : data,
            avax,
            (field === 'source' ? 'ethereum' : 'avalanche') as Network,
          ),
        ).rejects.toThrow();
      },
    );
  });

  describe('generateLockData', () => {
    /**
     * @target generateLockData should forward the selected destination byte without claiming an
     * operational assignment
     * @dependencies real address codec and EVM metadata producer
     * @scenario generate synthetic Avalanche destination metadata using fixture byte100
     * @expected the destination byte changes while both fee fields and address remain exact
     */
    it('should forward the selected destination byte without claiming an operational assignment', async () => {
      const { actions } = await createFixture();
      expect(await actions.generateLockData('avalanche', destination, '3', '2')).toEqual(
        `640000000000000002000000000000000314${'33'.repeat(20)}`,
      );
    });
  });
});
