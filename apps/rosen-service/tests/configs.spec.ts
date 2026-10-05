import { afterEach, describe, expect, it, vi } from 'vitest';

import { HealthStatusLevel } from '@rosen-bridge/health-check';

import { getConfig } from '../src/configs';
import {
  avalancheConfigData,
  avalancheHealthCheckData,
  createHealthFixture,
} from './avalanche/testUtils';
import { mockServiceConfig, serviceConfigMock } from './mocked/config.mock';

vi.mock('config', async () => ({
  default: (await import('./mocked/config.mock')).serviceConfigMock,
}));

afterEach(() => {
  mockServiceConfig({});
  vi.restoreAllMocks();
});

describe('getConfig', () => {
  /**
   * @target getConfig does not read optional Avalanche thresholds while disabled
   * @dependencies Node-config API double
   * @scenario Avalanche is absent or explicitly disabled and thresholds are malformed
   * @expected Avalanche stays disabled without reading either optional threshold
   */
  it.each([undefined, { enabled: false }])(
    'does not read optional Avalanche thresholds while disabled',
    (avalanche) => {
      mockServiceConfig({
        ...(avalanche === undefined ? {} : { avalanche }),
        'healthCheck.avalancheScannerWarnDiff': 'invalid',
        'healthCheck.avalancheScannerCriticalDiff': 'invalid',
      });
      const config = getConfig();
      expect(config.avalanche).toEqual(undefined);
      expect(config.healthCheck.avalancheScannerWarnDiff).toEqual(undefined);
      expect(config.healthCheck.avalancheScannerCriticalDiff).toEqual(undefined);
      expect(serviceConfigMock.get).not.toHaveBeenCalledWith(
        'healthCheck.avalancheScannerWarnDiff',
      );
      expect(serviceConfigMock.get).not.toHaveBeenCalledWith(
        'healthCheck.avalancheScannerCriticalDiff',
      );
    },
  );
  /**
   * @target getConfig freezes flat scanner thresholds in the consumer policy
   * @dependencies Actual Avalanche parser and Node-config API double
   * @scenario Complete policy and the canonical healthCheck keys are supplied
   * @expected Both public flat keys and the frozen actual consumer snapshot agree
   */
  it('freezes flat scanner thresholds in the consumer policy', () => {
    const thresholds = avalancheHealthCheckData();
    mockServiceConfig({
      avalanche: avalancheConfigData(),
      'healthCheck.avalancheScannerWarnDiff': thresholds.avalancheScannerWarnDiff,
      'healthCheck.avalancheScannerCriticalDiff': thresholds.avalancheScannerCriticalDiff,
    });
    const config = getConfig();
    expect(config.healthCheck.avalancheScannerWarnDiff).toEqual(5);
    expect(config.healthCheck.avalancheScannerCriticalDiff).toEqual(10);
    expect(config.avalanche?.health).toEqual({ warnDiff: 5, criticalDiff: 10, blockTime: 2 });
    expect(Object.isFrozen(config.avalanche?.health)).toEqual(true);
    serviceConfigMock.values.set('healthCheck.avalancheScannerWarnDiff', 1);
    expect(config.avalanche?.health.warnDiff).toEqual(5);
    expect(serviceConfigMock.get).toHaveBeenCalledWith('healthCheck.avalancheScannerWarnDiff');
    expect(serviceConfigMock.get).toHaveBeenCalledWith('healthCheck.avalancheScannerCriticalDiff');
  });
  /**
   * @target getConfig refuses an invalid flat %s
   * @dependencies Actual Avalanche parser and Node-config API double
   * @scenario One flat key is missing, noninteger or inverted against the other
   * @expected Service configuration fails before consumers are constructed
   */
  it.each([
    ['healthCheck.avalancheScannerWarnDiff', undefined],
    ['healthCheck.avalancheScannerWarnDiff', 0],
    ['healthCheck.avalancheScannerWarnDiff', 1.5],
    ['healthCheck.avalancheScannerCriticalDiff', undefined],
    ['healthCheck.avalancheScannerCriticalDiff', 5],
    ['healthCheck.avalancheScannerCriticalDiff', 4],
    ['healthCheck.avalancheScannerCriticalDiff', '10'],
  ])('refuses an invalid flat %s', (key, value) => {
    mockServiceConfig({
      avalanche: avalancheConfigData(),
      'healthCheck.avalancheScannerWarnDiff': 5,
      'healthCheck.avalancheScannerCriticalDiff': 10,
      [key]: value,
    });
    if (value === undefined) serviceConfigMock.values.delete(key as string);
    expect(() => getConfig()).toThrow();
  });
  /**
   * @target getConfig drives actual scanner health from its flat policy
   * @dependencies Actual parser, AvalancheRpcScanner and ScannerSyncHealthCheckParam
   * @scenario A qualified block is 50 seconds old and exactly one flat threshold changes
   * @expected Actual health changes through healthy, warning and critical statuses
   */
  it.each([
    [40, 80, HealthStatusLevel.HEALTHY],
    [20, 80, HealthStatusLevel.UNSTABLE],
    [20, 24, HealthStatusLevel.BROKEN],
  ])(
    'drives actual scanner health from its flat policy',
    async (warnDiff, criticalDiff, status) => {
      mockServiceConfig({
        avalanche: avalancheConfigData(),
        'healthCheck.avalancheScannerWarnDiff': warnDiff,
        'healthCheck.avalancheScannerCriticalDiff': criticalDiff,
      });
      const config = getConfig();
      const fixture = await createHealthFixture(config.avalanche!);
      fixture.block.timestamp = Date.now() / 1000 - 50;
      await fixture.health.updateStatus();
      expect(fixture.health.getHealthStatus()).toEqual(status);
      expect(fixture.health.getId()).toEqual('avalanche_scanner');
    },
  );
});
