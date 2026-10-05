import { afterEach, describe, expect, it, vi } from 'vitest';

import { CommitmentExtractor } from '@rosen-bridge/watcher-data-extractor';

import { registerExtractors } from '../../src/commitment/commitment-service';
import { commitmentPolicies } from '../avalanche/mocked/commitment.mock';
import { ergoAddress } from '../avalanche/testData';

vi.mock('../../src/configs', async () => {
  const { commitmentPolicies } = await import('../avalanche/mocked/commitment.mock');
  return { default: commitmentPolicies };
});

vi.mock('../../src/data-source', async () => {
  const { commitmentSource } = await import('../avalanche/mocked/commitment.mock');
  return { default: commitmentSource };
});

vi.mock('../../src/utils', async () => {
  const { tokenMapFixture } = await import('../avalanche/testUtils');
  return { getTokenMap: tokenMapFixture };
});

afterEach(() => {
  commitmentPolicies.avalanche = undefined;
  vi.restoreAllMocks();
});

describe('registerExtractors', () => {
  /**
   * @target registerExtractors keeps disabled Avalanche out of the legacy commitment loop
   * @dependencies Real Ergo scanner, CommitmentExtractor16, config/token-map API doubles
   * @scenario Avalanche is absent from otherwise configured legacy policies
   * @expected Legacy commitments register while Avalanche is skipped
   */
  it('keeps disabled Avalanche out of the legacy commitment loop', async () => {
    const scanner = createErgoScannerFixture();
    await registerExtractors(scanner);
    expect(
      scanner.newExtractors
        .map((extractor) => extractor.getId())
        .includes('avalanche-commitment-extractor'),
    ).toEqual(false);
    expect(scanner.newExtractors.length).toEqual(9);
  });
  /**
   * @target registerExtractors registers the configured Avalanche commitment consumer
   * @dependencies Real Ergo scanner, CommitmentExtractor16 and native token map
   * @scenario Complete Avalanche commitment policy is enabled
   * @expected Real Avalanche commitment extractor registers and preserves no-op historical initialization
   */
  it('registers the configured Avalanche commitment consumer', async () => {
    commitmentPolicies.avalanche = {
      addresses: { commitment: ergoAddress },
      tokens: { rwt: '22'.repeat(32) },
    };
    const scanner = createErgoScannerFixture();
    await registerExtractors(scanner);
    const extractor = scanner.newExtractors.find(
      (extractor) => extractor.getId() === 'avalanche-commitment-extractor',
    )!;
    expect(extractor instanceof CommitmentExtractor).toEqual(true);
    expect(scanner.newExtractors.length).toEqual(10);
    await expect(extractor.initializeData({ height: 0, hash: 'aa'.repeat(32) })).resolves.toEqual(
      undefined,
    );
  });
});

import { createErgoScannerFixture } from '../avalanche/testUtils';
