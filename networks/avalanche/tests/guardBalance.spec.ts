import { describe, expect, it } from 'vitest';

import { avalancheGuardBalanceReader } from '../src/guardBalance';
import { backendColdFixture } from './guardColdBalanceTestData';

describe('avalancheGuardBalanceReader', () => {
  describe('decode', () => {
    /**
     * @target avalancheGuardBalanceReader.decode should project both filtered
     * native pages into the existing card contract
     * @dependencies Actual backend source fixture filtered by native identity
     * @scenario Select AVAX from both custody pages with the existing tokenId
     * query
     * @expected Preserve both addresses, wrapped integer bigints and
     * significant decimals
     */
    it('should project both filtered native pages into the existing card contract', () => {
      const page = structuredClone(backendColdFixture);
      for (const custody of ['hot', 'cold'] as const) {
        page[custody].items = page[custody].items.filter((row) => row.balance.tokenId === 'avax');
        page[custody].total = 1;
      }
      const decoded = avalancheGuardBalanceReader.decode(page);
      expect(decoded.hot.items[0].balance.amount).toEqual(100000000000n);
      expect(decoded.cold.items[0].balance.amount).toEqual(500000000000n);
      expect(decoded.cold.items[0].address).toEqual(page.cold.items[0].address);
      expect(decoded.cold.items[0].balance.decimals).toEqual(9);
    });
    /**
     * @target avalancheGuardBalanceReader.decode should refuse a nonnative
     * token in a filtered native custody page
     * @dependencies Strict shared asset decoder and native projection
     * @scenario Return one JOE row in place of filtered AVAX
     * @expected Refuse the card response rather than show JOE as the native
     * token
     */
    it('should refuse a nonnative token in a filtered native custody page', () => {
      const page = structuredClone(backendColdFixture);
      for (const custody of ['hot', 'cold'] as const) {
        page[custody].items = [page[custody].items[0]];
        page[custody].total = 1;
      }
      expect(() => avalancheGuardBalanceReader.decode(page)).toThrow();
    });

    /**
     * @target avalancheGuardBalanceReader.decode should preserve prepared links for both native custody addresses
     * @dependencies Real shared asset decoder and backend source fixture
     * @scenario Filter both pages to AVAX and select Fuji explicitly
     * @expected Keep independent actual custody address links without changing wrapped units
     */
    it('should preserve prepared links for both native custody addresses', () => {
      const input = structuredClone(backendColdFixture);
      input.chainId = 43113;
      for (const custody of ['hot', 'cold'] as const) {
        input[custody].items = input[custody].items.filter((row) => row.balance.tokenId === 'avax');
        input[custody].total = 1;
      }
      const decoded = avalancheGuardBalanceReader.decode(input);
      for (const custody of ['hot', 'cold'] as const) {
        expect(decoded[custody].items[0].addressUrl).toEqual(
          `https://testnet.snowtrace.io/address/${input[custody].items[0].address}`,
        );
      }
    });

    /**
     * @target avalancheGuardBalanceReader.decode should refuse absent deployment for an empty native card
     * @dependencies Real shared asset decoder and native projection
     * @scenario Supply empty native pages without chainId
     * @expected Preserve unavailable card state without guessed address links
     */
    it('should refuse absent deployment for an empty native card', () => {
      expect(() =>
        avalancheGuardBalanceReader.decode({
          hot: { items: [], total: 0 },
          cold: { items: [], total: 0 },
        }),
      ).toThrow('Invalid Avalanche guard deployment');
    });
  });
});
