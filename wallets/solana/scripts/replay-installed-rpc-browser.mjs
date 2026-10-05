import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder, TextEncoder } from 'node:util';
import { createContext, runInContext } from 'node:vm';

const [consumerArgument, evidenceArgument, ...extraArguments] = process.argv.slice(2);
assert(
  consumerArgument && evidenceArgument && extraArguments.length === 0,
  'Usage: node scripts/replay-installed-rpc-browser.mjs <consumer-directory> <new-evidence-directory>',
);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const consumer = path.resolve(consumerArgument);
const evidence = path.resolve(evidenceArgument);
const requireConsumer = createRequire(path.join(consumer, 'package.json'));
const installed = path.dirname(path.dirname(requireConsumer.resolve('@rosen-ui/solana-wallet')));
const network = path.dirname(path.dirname(requireConsumer.resolve('@rosen-network/solana')));

/** Checks whether a resolved path lies inside a protected directory. */
const isWithin = (parent, child) => {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
};
assert(!isWithin(repository, evidence));
assert(!isWithin(installed, evidence));
assert(!isWithin(consumer, evidence), 'Evidence directory must be outside the consumer');
const repositoryPhysical = fs.realpathSync(repository);
const consumerPhysical = fs.realpathSync(consumer);
const modulesPhysical = fs.realpathSync(path.join(consumerPhysical, 'node_modules'));
const installedPhysical = fs.realpathSync(installed);
const networkPhysical = fs.realpathSync(network);
assert(isWithin(modulesPhysical, installedPhysical), 'Package resolves outside this consumer');
assert(isWithin(modulesPhysical, networkPhysical), 'Network resolves outside this consumer');
const evidencePhysical = path.join(
  fs.realpathSync(path.dirname(evidence)),
  path.basename(evidence),
);
assert(!isWithin(repositoryPhysical, evidencePhysical));
assert(!isWithin(consumerPhysical, evidencePhysical));
assert(!isWithin(installedPhysical, evidencePhysical));
assert(!isWithin(modulesPhysical, evidencePhysical));
const compiler = fs.realpathSync(requireConsumer.resolve('esbuild'));
assert(isWithin(modulesPhysical, compiler), 'Compiler resolves outside this consumer');
const esbuild = requireConsumer('esbuild');
assert(!fs.existsSync(evidence), 'Evidence directory must be new');
const volume = fs.statfsSync(path.dirname(evidence));
assert(volume.bavail * volume.bsize >= 10 * 1024 ** 3, 'Insufficient artifact headroom');
fs.mkdirSync(evidence);
assert.equal(fs.realpathSync(evidence), evidencePhysical);

/** Computes a byte-exact content pin without embedding machine paths. */
const pin = (bytes) => ({
  bytes: bytes.length,
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
});
/** Lists a complete installed tree without following symbolic links. */
const treePins = (directory, prefix = '') =>
  fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      assert(!entry.isSymbolicLink(), `Installed tree contains a symbolic link: ${entry.name}`);
      const relative = path.posix.join(prefix, entry.name);
      const absolute = path.join(directory, entry.name);
      return entry.isDirectory()
        ? treePins(absolute, relative)
        : [{ relative, ...pin(fs.readFileSync(absolute)) }];
    })
    .sort((left, right) => left.relative.localeCompare(right.relative));
/** Writes one new evidence file and refuses every overwrite. */
const write = (name, bytes) => fs.writeFileSync(path.join(evidence, name), bytes, { flag: 'wx' });
/** Serializes stable JSON and records the exact bytes written. */
const writeJson = (name, value) => {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  write(name, bytes);
  return pin(bytes);
};
/** Replaces exactly one import seam and refuses missing or ambiguous anchors. */
const replaceOnce = (source, before, after) => {
  assert.equal(source.split(before).length, 2, `Fixture import seam changed: ${before}`);
  return source.replace(before, after);
};

const fixtureNames = [
  'browserSessionReadTestUtils.ts',
  'browserRpcTestUtils.ts',
  'browserRpcTestData.ts',
  'rpcWalletFeeTestUtils.ts',
  'testData.ts',
];
const fixturePath = (name) => path.join(repository, 'tests', name);
const canonicalPins = () =>
  fixtureNames.map((name) => ({ name, ...pin(fs.readFileSync(fixturePath(name))) }));
const canonicalBefore = canonicalPins();
const installedBefore = treePins(installedPhysical);
const dependenciesBefore = treePins(modulesPhysical);
const packageManifest = JSON.parse(
  fs.readFileSync(path.join(installedPhysical, 'package.json'), 'utf8'),
);
const beforeManifests = {
  canonical: writeJson('canonical-before.json', canonicalBefore),
  installed: writeJson('installed-before.json', installedBefore),
  dependencies: writeJson('dependencies-before.json', dependenciesBefore),
};
const originals = new Map(fixtureNames.map((name) => [name, fs.readFileSync(fixturePath(name))]));
for (const [name, bytes] of originals) write(`original-${name}`, bytes);

/** Adapts only the two runtime imports from package source to the installed package. */
const adapted = new Map(originals);
for (const name of ['browserSessionReadTestUtils.ts', 'rpcWalletFeeTestUtils.ts']) {
  const source = originals.get(name).toString('utf8');
  const installedImport = replaceOnce(
    source,
    "from '../src/index'",
    "from '@rosen-ui/solana-wallet'",
  );
  adapted.set(name, Buffer.from(installedImport, 'utf8'));
}
for (const name of fixtureNames) write(name, adapted.get(name));

/** Bundles an installed-package fixture and executes it without Node globals or network access. */
const runFixture = async (entry, globalName, run) => {
  const output = await esbuild.build({
    absWorkingDir: consumerPhysical,
    entryPoints: [path.join(evidencePhysical, entry)],
    nodePaths: [path.join(consumerPhysical, 'node_modules')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName,
    target: 'es2022',
    write: false,
    metafile: true,
  });
  assert(Object.values(output.metafile.outputs).every((item) => item.imports.length === 0));
  const inputs = [];
  const disabledInputs = [];
  for (const [item, metadata] of Object.entries(output.metafile.inputs)) {
    if (item.startsWith('(disabled):')) {
      assert.equal(item, '(disabled):node_modules/buffer/index.js');
      assert.equal(metadata.bytes, 0);
      assert.deepEqual(metadata.imports, []);
      disabledInputs.push(item);
    } else inputs.push(fs.realpathSync(path.resolve(consumerPhysical, item)));
  }
  assert(
    inputs.every((item) => isWithin(evidencePhysical, item) || isWithin(modulesPhysical, item)),
    'Bundle resolved a module outside this consumer and its fixtures',
  );
  assert(
    inputs.some((item) => isWithin(installedPhysical, item)),
    'Installed wallet package was not bundled',
  );
  assert(
    inputs.some((item) => isWithin(networkPhysical, item)),
    'Installed network dependency was not bundled',
  );
  const sourceRuntime = fs.realpathSync(path.join(repositoryPhysical, 'src'));
  assert(
    inputs.every((item) => !isWithin(sourceRuntime, item)),
    'Source runtime overlay',
  );
  assert(
    inputs.every((item) => !item.replaceAll('\\', '/').includes('/ergo-lib-wasm-nodejs/')),
    'Node-only Ergo WASM package entered the browser bundle',
  );

  let ambientFetchCalls = 0;
  const context = createContext({
    AbortController,
    AbortSignal,
    ArrayBuffer,
    Blob,
    DataView,
    Headers,
    ReadableStream,
    Request,
    Response,
    TextDecoder,
    TextEncoder,
    TransformStream,
    URL,
    URLSearchParams,
    Uint8Array,
    WebAssembly,
    WritableStream,
    atob,
    btoa,
    clearTimeout,
    console,
    fetch: () => {
      ambientFetchCalls += 1;
      throw new Error('NETWORK_FORBIDDEN');
    },
    setTimeout,
    structuredClone,
  });
  const bundle = output.outputFiles[0].contents;
  write(`${globalName}.js`, bundle);
  const metafilePin = writeJson(`${globalName}-metafile.json`, output.metafile);
  runInContext(output.outputFiles[0].text, context, { timeout: 10000 });
  const result = await run(context[globalName]);
  assert.deepEqual(
    { ...result.absentGlobals },
    { Buffer: 'undefined', process: 'undefined', require: 'undefined' },
  );
  assert.equal(ambientFetchCalls, 0);
  return {
    bundle: pin(bundle),
    metafile: metafilePin,
    disabledInputs,
    ambientFetchCalls,
    result,
  };
};

const sessionRead = await runFixture(
  'browserSessionReadTestUtils.ts',
  'SolanaInstalledSessionRead',
  (api) => api.runBrowserSessionReadChecks(),
);
const rpc = await runFixture('browserRpcTestUtils.ts', 'SolanaInstalledRpc', (api) =>
  api.runBrowserRpcChecks(),
);
assert.equal(sessionRead.result.checkCount, 21);
assert.equal(sessionRead.result.checks.length, 21);
assert.equal(rpc.result.checks, 44);
assert.equal(rpc.result.scenarios, 6);

const canonicalAfter = canonicalPins();
const installedAfter = treePins(installedPhysical);
const dependenciesAfter = treePins(modulesPhysical);
assert.deepEqual(canonicalAfter, canonicalBefore, 'Canonical fixtures changed during replay');
assert.deepEqual(installedAfter, installedBefore, 'Installed package changed during replay');
assert.deepEqual(
  dependenciesAfter,
  dependenciesBefore,
  'Installed dependencies changed during replay',
);
const afterManifests = {
  canonical: writeJson('canonical-after.json', canonicalAfter),
  installed: writeJson('installed-after.json', installedAfter),
  dependencies: writeJson('dependencies-after.json', dependenciesAfter),
};
for (const name of fixtureNames)
  assert(
    fs
      .readFileSync(path.join(evidencePhysical, name))
      .equals(
        name === 'browserSessionReadTestUtils.ts' || name === 'rpcWalletFeeTestUtils.ts'
          ? adapted.get(name)
          : originals.get(name),
      ),
    `Adapted fixture changed after bundling: ${name}`,
  );

const result = {
  success: true,
  controls: {
    sessionRead: sessionRead.result.checkCount,
    rpcWalletFee: rpc.result.checks,
    total: sessionRead.result.checkCount + rpc.result.checks,
  },
  scenarios: rpc.result.scenarios,
  versions: { node: process.version, esbuild: esbuild.version },
  installedPackage: { name: packageManifest.name, version: packageManifest.version },
  fileCounts: {
    canonicalFixtures: canonicalBefore.length,
    installedPackage: installedBefore.length,
    dependencies: dependenciesBefore.length,
  },
  before: beforeManifests,
  after: afterManifests,
  fixtures: fixtureNames.map((name) => ({
    name,
    original: pin(originals.get(name)),
    adapted: pin(adapted.get(name)),
  })),
  sessionRead,
  rpc,
};
const resultPin = writeJson('result.json', result);
process.stdout.write(
  `${JSON.stringify({ success: true, controls: result.controls, fileCounts: result.fileCounts, result: resultPin })}\n`,
);
