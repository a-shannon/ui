import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AvalancheSafetyState } from '@rosen-bridge/evm-scanner';
import { getDataSource } from '@rosen-ui/data-source';

import { createAvalancheCalculatorConfig } from '../../src/avalanche/calculator';
import { parseAvalancheConfig } from '../../src/avalanche/config';
import { registerAvalancheSafety } from '../../src/avalanche/data-source';
import { createAvalancheScanner } from '../../src/avalanche/scanner';
import { storedCalculator } from './assetCalculatorTestUtils';
import { finalizedRpcFixture } from './mocked/runtime.mock';
import { finalizedHash } from './testData';
import { avalancheConfigData, avalancheHealthCheckData, tokenMapFixture } from './testUtils';

/** Explicit opt-in owns a fresh loopback cluster; never connects to an existing database. */
export const createCalculatorCluster = async () => {
  const bin = process.env.AVALANCHE_POSTGRES_BIN;
  const root = process.env.AVALANCHE_POSTGRES_ARTIFACT_ROOT;
  if (!bin || !root) throw new Error('Explicit PostgreSQL binary and artifact roots are required');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(path.resolve(root), 'service-calculator-pg-'));
  const data = path.join(directory, 'data');
  const password = randomBytes(24).toString('hex');
  const passwordFile = path.join(directory, 'password');
  const listener = net.createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const port = (listener.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const extension = process.platform === 'win32' ? '.exe' : '';
  const environment = { ...process.env, PGPASSWORD: password };
  /** Run only this cluster's binaries; capture sanitized logs without password-bearing arguments. */
  const command = (name: string, args: string[]) => {
    // PostgreSQL children on Windows retain inherited pipes; files keep pg_ctl bounded.
    const log = fs.openSync(path.join(directory, 'commands.log'), 'a');
    let result: ReturnType<typeof spawnSync>;
    try {
      result = spawnSync(path.join(bin, name + extension), args, {
        env: environment,
        timeout: 30000,
        windowsHide: true,
        stdio: ['ignore', log, log],
      });
    } finally {
      fs.closeSync(log);
    }
    fs.appendFileSync(path.join(directory, 'commands.log'), `${name}: ${result.status}\n`);
    if (result.error || result.status !== 0)
      throw new Error(`Owned PostgreSQL ${name} failed; inspect its command log`);
    return result.status;
  };
  /** Start only the fresh owned data directory on the reserved loopback port. */
  const start = () =>
    command('pg_ctl', [
      '-D',
      data,
      '-l',
      path.join(directory, 'postgres.log'),
      '-o',
      `-h 127.0.0.1 -p ${port}`,
      '-w',
      'start',
    ]);
  /** Stop the owned cluster and require its postmaster ownership file to disappear. */
  const stop = () => {
    if (fs.existsSync(path.join(data, 'postmaster.pid')))
      command('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
    if (fs.existsSync(path.join(data, 'postmaster.pid')))
      throw new Error('Owned PostgreSQL postmaster remains active');
  };
  fs.writeFileSync(passwordFile, password, { mode: 0o600 });
  try {
    command('initdb', [
      '-D',
      data,
      '-U',
      'rosen_test',
      '--pwfile',
      passwordFile,
      '--auth-host=scram-sha-256',
      '--auth-local=scram-sha-256',
      '--encoding=UTF8',
      '--locale=C',
    ]);
    start();
    command('createdb', [
      '-h',
      '127.0.0.1',
      '-p',
      String(port),
      '-U',
      'rosen_test',
      'calculator_test',
    ]);
  } catch (error) {
    stop();
    throw error;
  } finally {
    fs.unlinkSync(passwordFile);
  }
  const url = `postgresql://rosen_test:${password}@127.0.0.1:${port}/calculator_test`;
  /** A separate Node process reads persisted rows using actual entity repositories. */
  const snapshot = () => {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(new URL('./postgresCalculatorSnapshot.ts', import.meta.url)),
      ],
      {
        env: { ...process.env, AVALANCHE_POSTGRES_TEST_URL: url },
        encoding: 'utf8',
        timeout: 60000,
        windowsHide: true,
      },
    );
    if (result.error || result.status !== 0)
      throw new Error(`PostgreSQL snapshot process failed: ${result.stderr}`);
    return JSON.parse(result.stdout);
  };
  return { directory, data, url, start, stop, snapshot };
};

/** Actual production data-source registrations and migrations; scanner policy is stored in PostgreSQL. */
export const postgresCalculatorFixture = async (
  cluster: Awaited<ReturnType<typeof createCalculatorCluster>>,
  wrapped = true,
) => {
  const database = registerAvalancheSafety(getDataSource(cluster.url, false, false));
  await database.initialize();
  await database.runMigrations();
  await database.getRepository(AvalancheSafetyState).clear();
  // Keep test cases independent while retaining the migration history.
  for (const table of ['bridged_asset_entity', 'locked_asset_entity', 'token_entity'])
    await database.query(`DELETE FROM "${table}"`);
  const state: AvalancheSafetyState = Object.assign(new AvalancheSafetyState(), {
    scanner: 'avalanche',
    chainId: '43114',
    sourceId: 'provider-a',
    initialHeight: 0,
    policy: 'helicon-settled-v1',
    finalizedHeight: 10,
    finalizedHash,
    holdReason: null,
  });
  await database.getRepository(AvalancheSafetyState).save(state);
  const config = parseAvalancheConfig(
    { ...avalancheConfigData(), chainId: 43114 },
    avalancheHealthCheckData(),
  )!;
  const tokenMap = await tokenMapFixture(true, wrapped);
  const scanner = await createAvalancheScanner(config, database, tokenMap);
  const rpc = finalizedRpcFixture(43114);
  const calculator = createAvalancheCalculatorConfig(config, database, scanner);
  const asset = storedCalculator({ tokenMap, calculator }, database);
  return { database, state, config, tokenMap, scanner, rpc, calculator, asset };
};
