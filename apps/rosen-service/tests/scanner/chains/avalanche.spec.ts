import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AvalancheRpcScanner, AvalancheSafetyState } from '@rosen-bridge/evm-scanner';

import { parseAvalancheConfig } from '../../../src/avalanche/config';
import { startAvalancheScanner } from '../../../src/scanner/chains/avalanche';
import { startupConfig, startupDatabase } from '../../avalanche/mocked/startup.mock';
import { avalancheConfigData, avalancheHealthCheckData, deferred } from '../../avalanche/testUtils';

const schedule = vi.hoisted(() =>
  vi.fn<(scanner: AvalancheRpcScanner, filename: string, interval: number) => Promise<void>>(),
);

vi.mock('../../../src/configs', async () => {
  const { startupConfig } = await import('../../avalanche/mocked/startup.mock');
  return { default: startupConfig };
});

vi.mock('../../../src/data-source', async () => {
  const { startupDatabase } = await import('../../avalanche/mocked/startup.mock');
  return { default: startupDatabase.dataSource };
});

vi.mock('../../../src/utils', async () => {
  const { tokenMapFixture } = await import('../../avalanche/testUtils');
  return { getTokenMap: tokenMapFixture };
});

vi.mock('../../../src/scanner/scanner-utils', () => ({ startScanner: schedule }));

beforeEach(() => {
  startupConfig.avalanche = undefined;
  startupDatabase.state.holdReason = null;
  schedule.mockReset().mockResolvedValue(undefined);
  vi.spyOn(
    startupDatabase.dataSource.getRepository(AvalancheSafetyState),
    'findOneBy',
  ).mockResolvedValue(startupDatabase.state);
});

describe('startAvalancheScanner', () => {
  /**
   * @target startAvalancheScanner does not schedule disabled Avalanche
   * @dependencies Explicit disabled config and scheduler API double
   * @scenario Avalanche is not configured
   * @expected No scanner update is scheduled
   */
  it('does not schedule disabled Avalanche', async () => {
    expect(await startAvalancheScanner()).toEqual(undefined);
    expect(schedule.mock.calls.length).toEqual(0);
  });
  /**
   * @target startAvalancheScanner awaits initial settled qualification before exposing the scanner
   * @dependencies Real scanner/extractor, repository and scheduler API doubles
   * @scenario Initial scheduler update is still pending
   * @expected Scanner is exposed only after the awaited update and persisted qualification
   */
  it('awaits initial settled qualification before exposing the scanner', async () => {
    startupConfig.avalanche = parseAvalancheConfig(
      avalancheConfigData(),
      avalancheHealthCheckData(),
    );
    const entered = deferred<void>();
    const pending = deferred<void>();
    schedule.mockImplementationOnce(async () => {
      entered.resolve();
      await pending.promise;
    });
    let completed = false;
    const result = startAvalancheScanner().then((scanner) => {
      completed = true;
      return scanner;
    });
    await entered.promise;
    expect(completed).toEqual(false);
    pending.resolve();
    const scanner = await result;
    expect(scanner?.name()).toEqual('avalanche');
    expect(completed).toEqual(true);
    expect(schedule.mock.calls[0][2]).toEqual(5000);
  });
  /**
   * @target startAvalancheScanner fails startup if the initial update leaves a hold
   * @dependencies Actual persisted safety qualification and scheduler API double
   * @scenario Initial update returns but leaves persisted scanner safety held
   * @expected Startup rejects instead of exposing a calculator-ready scanner
   */
  it('fails startup if the initial update leaves a hold', async () => {
    startupConfig.avalanche = parseAvalancheConfig(
      avalancheConfigData(),
      avalancheHealthCheckData(),
    );
    startupDatabase.state.holdReason = 'initial contradiction';
    await expect(startAvalancheScanner()).rejects.toThrow();
    expect(schedule.mock.calls.length).toEqual(1);
  });
});
