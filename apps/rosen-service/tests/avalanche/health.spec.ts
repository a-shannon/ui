import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BlockEntity } from '@rosen-bridge/abstract-scanner';
import { HealthCheck, HealthStatusLevel } from '@rosen-bridge/health-check';

import { parseAvalancheConfig } from '../../src/avalanche/config';
import { createAvalancheScannerHealth } from '../../src/avalanche/health';
import { databaseFixture } from './mocked/runtime.mock';
import { avalancheConfigData, avalancheHealthCheckData } from './testUtils';

afterEach(() => vi.restoreAllMocks());

describe('createAvalancheScannerHealth', () => {
  /**
   * @target createAvalancheScannerHealth reports qualified completed scanner blocks
   * @dependencies Actual scanner and ScannerSyncHealthCheckParam
   * @scenario A completed fresh scanner block is read under persisted safety
   * @expected The health status becomes healthy with a finite assessment time
   */
  it('reports qualified completed scanner blocks', async () => {
    const fixture = await createHealthFixture();
    expect(fixture.health.getHealthStatus()).toEqual(HealthStatusLevel.BROKEN);
    expect(Number.isFinite(fixture.health.getLastUpdatedTime()?.valueOf())).toEqual(true);
    await fixture.health.updateStatus();
    expect(fixture.health.getHealthStatus()).toEqual(HealthStatusLevel.HEALTHY);
    expect(fixture.health.getId()).toEqual('avalanche_scanner');
  });
  /**
   * @target createAvalancheScannerHealth invalidates an earlier healthy report when persisted safety is held
   * @dependencies Actual persisted scanner safety reader and HealthCheck notification history
   * @scenario A previously healthy scanner is placed on a persisted hold
   * @expected Report and notification history complete as broken instead of retaining healthy state
   */
  it('invalidates an earlier healthy report when persisted safety is held', async () => {
    const fixture = await createHealthFixture();
    const notify = vi.fn(async () => undefined);
    const consumer = new HealthCheck(notify);
    consumer.register(fixture.health);
    await consumer.update();
    fixture.state.holdReason = 'operator hold';
    await consumer.update();
    expect(consumer.getHealthStatus()[0].status).toEqual(HealthStatusLevel.BROKEN);
    expect(fixture.health.getLastTrialErrorTime()).toEqual(undefined);
    expect(Number.isFinite(fixture.health.getLastUpdatedTime()?.valueOf())).toEqual(true);
    expect(notify).toHaveBeenCalled();
  });
  /**
   * @target createAvalancheScannerHealth keeps latest-attempt ownership across overlapping consumer updates
   * @dependencies Actual scanner safety exclusion and actual HealthCheck with notifier
   * @scenario An older block read finishes after a newer health attempt fails while it is pending
   * @expected The older completion cannot replace the newer broken assessment
   */
  it('keeps latest-attempt ownership across overlapping consumer updates', async () => {
    const fixture = await createHealthFixture();
    const pending = deferred<BlockEntity[]>();
    const started = deferred<void>();
    // Only one read is performed; the second attempt is rejected by the real scanner lease.
    fixture.findBlocks.mockImplementation(async () => {
      started.resolve();
      return pending.promise;
    });
    const consumer = new HealthCheck(vi.fn(async () => undefined));
    consumer.register(fixture.health);
    const older = consumer.update();
    await started.promise;
    expect(fixture.health.getHealthStatus()).toEqual(HealthStatusLevel.BROKEN);
    await consumer.update();
    pending.resolve([fixture.block]);
    await older;
    expect(fixture.health.getHealthStatus()).toEqual(HealthStatusLevel.BROKEN);
    expect(consumer.getHealthStatus()[0].status).toEqual(HealthStatusLevel.BROKEN);
    expect(Number.isFinite(fixture.health.getLastUpdatedTime()?.valueOf())).toEqual(true);
    expect(fixture.findBlocks.mock.calls.length).toEqual(1);
  });
  /**
   * @target createAvalancheScannerHealth rejects a missing completed scanner block
   * @dependencies Actual scanner and in-memory block repository API double
   * @scenario Persisted safety is valid but there is no completed block
   * @expected Health assessment remains broken
   */
  it('rejects a missing completed scanner block', async () => {
    const fixture = await createHealthFixture();
    fixture.findBlocks.mockResolvedValue([]);
    await fixture.health.updateStatus();
    expect(fixture.health.getHealthStatus()).toEqual(HealthStatusLevel.BROKEN);
  });
  /**
   * @target createAvalancheScannerHealth applies scanner cadence in seconds
   * @dependencies Actual ScannerSyncHealthCheckParam
   * @scenario Completed block is 100 seconds old against a 20-second critical policy
   * @expected Millisecond polling config is converted to seconds and the stale block is broken
   */
  it('applies scanner cadence in seconds', async () => {
    const fixture = await createHealthFixture();
    fixture.block.timestamp = Date.now() / 1000 - 100;
    await fixture.health.updateStatus();
    expect(fixture.health.getHealthStatus()).toEqual(HealthStatusLevel.BROKEN);
  });
  /**
   * @target createAvalancheScannerHealth rejects invalid completed %s=%s
   * @dependencies Actual persisted scanner safety and block repository API double
   * @scenario Exactly one stored block field violates completed settled-block policy
   * @expected Health cannot become healthy from an invalid timestamp or height
   */
  it.each([
    ['height', 11],
    ['height', -1],
    ['height', 1.5],
    ['timestamp', Number.NaN],
    ['timestamp', -1],
    ['timestamp', Date.now() / 1000 + 3600],
  ])('rejects invalid completed %s=%s', async (key, value) => {
    const fixture = await createHealthFixture();
    Object.assign(fixture.block, { [key as string]: value });
    await fixture.health.updateStatus();
    expect(fixture.health.getHealthStatus()).toEqual(HealthStatusLevel.BROKEN);
  });
  /**
   * @target createAvalancheScannerHealth requires the configured Avalanche scanner
   * @dependencies Explicit configured policy
   * @scenario Enabled health policy lacks an Avalanche scanner
   * @expected Construction fails instead of observing another chain
   */
  it('requires the configured Avalanche scanner', () => {
    const fixture = databaseFixture();
    expect(() =>
      createAvalancheScannerHealth(
        parseAvalancheConfig(avalancheConfigData(), avalancheHealthCheckData())!,
        fixture.dataSource,
        undefined,
      ),
    ).toThrow();
  });
});

import { createHealthFixture, deferred } from './testUtils';
