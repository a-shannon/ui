import { describe, expect, it } from 'vitest';

import { createActionsFixture } from './actionsTestUtils';
import { exampleCalldata, exampleLock, exampleMetadata, exampleSender, joe } from './erc20TestData';
import { avax } from './testData';

describe('createAvalancheActions', () => {
  describe('generateTxParameters', () => {
    /**
     * @target generateTxParameters should preserve native raw value and metadata
     * @dependencies real TokenMap and EVM producer; mocked provider API reads
     * @scenario produce ten wrapped AVAX units with the frozen metadata
     * @expected exact native value, custody, sender and metadata are returned
     */
    it('should preserve native raw value and metadata', async () => {
      const { actions } = await createActionsFixture();
      expect(
        await actions.generateTxParameters(
          avax.tokenId,
          exampleLock,
          exampleSender,
          10n,
          exampleMetadata,
          avax,
          'avalanche',
        ),
      ).toEqual({
        to: exampleLock,
        from: exampleSender,
        data: `0x${exampleMetadata}`,
        value: '0x174876e800',
      });
    });

    /**
     * @target generateTxParameters should preserve the frozen token lock bytes
     * @dependencies real mixed TokenMap and EVM producer; mocked provider API reads
     * @scenario produce ten wrapped JOE units directly from the network helper
     * @expected recipient, raw amount and metadata suffix match the frozen example
     */
    it('should preserve the frozen token lock bytes', async () => {
      const { actions } = await createActionsFixture();
      expect(
        await actions.generateTxParameters(
          joe.tokenId,
          exampleLock,
          exampleSender,
          10n,
          exampleMetadata,
          joe,
          'avalanche',
        ),
      ).toEqual({ to: joe.tokenId, from: exampleSender, data: exampleCalldata });
    });

    /**
     * @target generateTxParameters should reject isolated %s before provider reads
     * @dependencies real TokenMap and mocked provider API reads
     * @scenario change only asset identity, custody, fee coverage or source chain
     * @expected no invalid transaction is exposed and no provider API is called
     */
    it.each(['asset', 'custody', 'amount', 'chain'] as const)(
      'should reject isolated %s before provider reads',
      async (fault) => {
        const { actions, provider } = await createActionsFixture();
        await expect(
          actions.generateTxParameters(
            fault === 'asset' ? avax.tokenId : joe.tokenId,
            fault === 'custody' ? exampleSender : exampleLock,
            exampleSender,
            fault === 'amount' ? 5n : 10n,
            exampleMetadata,
            joe,
            fault === 'chain' ? 'ethereum' : 'avalanche',
          ),
        ).rejects.toThrow();
        expect(provider.getNetwork).not.toHaveBeenCalled();
      },
    );
  });

  describe('generateLockData', () => {
    /**
     * @target generateLockData should retain the configured destination assignment
     * @dependencies actual address codec and EVM metadata producer
     * @scenario encode synthetic Avalanche destination byte100 and fees two plus three
     * @expected only the destination byte differs from the existing-chain encoding
     */
    it('should retain the configured destination assignment', async () => {
      const { actions } = await createActionsFixture();
      expect(await actions.generateLockData('avalanche', exampleLock, '3', '2')).toEqual(
        `640000000000000002000000000000000314${'11'.repeat(20)}`,
      );
    });
  });
});
