import { BlockEntity, PROCEED } from '@rosen-bridge/abstract-scanner';
import { type AvalancheRpcScanner, AvalancheSafetyState } from '@rosen-bridge/evm-scanner';
import type { DataSource } from '@rosen-bridge/extended-typeorm';
import { HealthStatusLevel } from '@rosen-bridge/health-check';
import { ScannerSyncHealthCheckParam } from '@rosen-bridge/scanner-sync-check';

import type { AvalancheServiceConfig } from './config';

/** Report completed scanner blocks only while persisted Avalanche safety remains qualified. */
export const createAvalancheScannerHealth = (
  config: AvalancheServiceConfig,
  dataSource: DataSource,
  scanner: AvalancheRpcScanner | undefined,
) => {
  if (scanner?.name() !== 'avalanche') throw new Error('Avalanche scanner is required');
  const health = new ScannerSyncHealthCheckParam(
    scanner.name(),
    async () =>
      scanner.withSafety(async () => {
        const state = await dataSource
          .getRepository(AvalancheSafetyState)
          .findOneBy({ scanner: scanner.name() });
        if (
          !state ||
          state.chainId !== config.chainId.toString() ||
          state.sourceId !== config.selectedSourceId ||
          state.initialHeight !== config.initialHeight
        ) {
          throw new Error('Avalanche health and scanner policy mismatch');
        }
        const finalizedHeight = state.finalizedHeight;
        const [block] = await dataSource.getRepository(BlockEntity).find({
          where: { status: PROCEED, scanner: scanner.name() },
          order: { height: 'DESC' },
          take: 1,
        });
        await scanner.assertUsable();
        if (
          !block ||
          !Number.isSafeInteger(block.height) ||
          block.height < 0 ||
          finalizedHeight === null ||
          !Number.isSafeInteger(finalizedHeight) ||
          block.height > finalizedHeight ||
          !Number.isFinite(block.timestamp) ||
          block.timestamp < 0 ||
          block.timestamp > Date.now() / 1000
        )
          throw new Error('Invalid completed Avalanche scanner block');
        return { height: block.height, timestamp: block.timestamp };
      }),
    config.health.warnDiff,
    config.health.criticalDiff,
    config.health.blockTime,
    config.intervalMs / 1000,
  );
  let qualified = false;
  let attempt = 0;
  let assessedAt = new Date();
  let errorMessage: string | undefined;
  let status = HealthStatusLevel.BROKEN;
  let details: string | undefined;
  let description = 'Avalanche scanner safety is pending or unavailable';
  const updateStatus = health.updateStatus;
  const getHealthStatus = health.getHealthStatus;
  const getDetails = health.getDetails;
  const getDescription = health.getDescription;
  /** Only the latest assessment can replace the qualified report snapshot. */
  health.updateStatus = async () => {
    const owner = ++attempt;
    qualified = false;
    assessedAt = new Date();
    errorMessage = undefined;
    try {
      await updateStatus();
      if (owner !== attempt) return;
      assessedAt = new Date();
      status = getHealthStatus();
      details = getDetails();
      description = getDescription();
      qualified = true;
    } catch {
      if (owner === attempt) {
        assessedAt = new Date();
        errorMessage = 'Avalanche scanner safety assessment failed';
      }
    }
  };
  /** Report broken until the current update has completed under persisted safety. */
  health.getHealthStatus = () => (qualified ? status : HealthStatusLevel.BROKEN);
  /** Keep failed or pending assessments distinct from an obsolete successful block. */
  health.getDetails = () =>
    qualified ? details : 'Avalanche scanner safety is pending or unavailable';
  /** Expose the report description captured by the latest qualified assessment. */
  health.getDescription = () =>
    qualified ? description : 'Avalanche scanner safety is pending or unavailable';
  /** Provide a finite assessment time even before the first completed scanner read. */
  health.getLastUpdatedTime = () => new Date(assessedAt);
  /** Expose only the latest attempt's error. */
  health.getLastTrialErrorMessage = () => errorMessage;
  /** A completed broken assessment remains a broken notification-history entry. */
  health.getLastTrialErrorTime = () => undefined;
  return health;
};
