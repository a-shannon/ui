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
  'Usage: node scripts/replay-installed-browser.mjs <consumer-directory> <new-evidence-directory>',
);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const consumer = path.resolve(consumerArgument);
const evidence = path.resolve(evidenceArgument);
const requireConsumer = createRequire(path.join(consumer, 'package.json'));
const installed = path.dirname(path.dirname(requireConsumer.resolve('@rosen-network/solana')));

/** Checks whether a resolved path lies inside a protected directory. */
const isWithin = (parent, child) => {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
};
assert(!isWithin(repository, evidence) && !isWithin(installed, evidence));
assert(!isWithin(path.join(consumer, 'node_modules'), evidence));
const repositoryPhysical = fs.realpathSync(repository);
const modulesPhysical = fs.realpathSync(path.join(consumer, 'node_modules'));
const installedPhysical = fs.realpathSync(installed);
assert(isWithin(modulesPhysical, installedPhysical), 'Package resolves outside this consumer');
const evidencePhysical = path.join(
  fs.realpathSync(path.dirname(evidence)),
  path.basename(evidence),
);
assert(!isWithin(repositoryPhysical, evidencePhysical));
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
/** Lists the complete installed package payload without following symlinks. */
const packagePins = (directory, prefix = '') =>
  fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      assert(!entry.isSymbolicLink(), 'Installed package contains a symbolic link');
      const relative = path.posix.join(prefix, entry.name);
      const absolute = path.join(directory, entry.name);
      return entry.isDirectory()
        ? packagePins(absolute, relative)
        : [{ relative, ...pin(fs.readFileSync(absolute)) }];
    })
    .sort((left, right) => left.relative.localeCompare(right.relative));
/** Writes one new artifact and refuses overwrites. */
const write = (name, bytes) => fs.writeFileSync(path.join(evidence, name), bytes, { flag: 'wx' });
/** Replaces exactly one reviewed fixture seam, refusing ambiguous or missing anchors. */
const replaceOnce = (source, before, after) => {
  assert.equal(source.split(before).length, 2, `Fixture seam changed: ${before}`);
  return source.replace(before, after);
};

const names = [
  'browserBuildTestUtils.ts',
  'browserFeeQuoteTestUtils.ts',
  'browserBuildTestData.ts',
  'testData.ts',
  'testUtils.ts',
];
const originals = new Map(
  names.map((name) => [name, fs.readFileSync(path.join(repository, 'tests', name))]),
);
const beforePackage = packagePins(installed);
for (const [name, bytes] of originals) write(`original-${name}`, bytes);
/** Normalizes fixture line endings before matching literal import and helper seams. */
const normalized = (name) => originals.get(name).toString('utf8').replaceAll('\r\n', '\n');
const helper = normalized('testUtils.ts');
const keypair = helper.match(
  /export const keypair = \(seed: number\): Keypair =>\n {2}Keypair\.fromSeed\(Uint8Array\.from\(\{ length: 32 \}, \(_, index\) => seed \+ index\)\);/g,
);
assert.equal(keypair?.length, 1, 'Deterministic keypair fixture changed');
write(
  'testUtils.ts',
  `import { Keypair } from '@solana/web3.js';\nexport { ergoDestination } from './testData';\n${keypair[0]}\n`,
);
for (const name of ['testData.ts', 'browserBuildTestData.ts']) write(name, originals.get(name));
let signing = replaceOnce(
  normalized('browserBuildTestUtils.ts'),
  "from '../src/index'",
  "from '@rosen-network/solana'",
);
signing = replaceOnce(signing, "import * as ergo from 'ergo-lib-wasm-nodejs';\n", '');
signing = replaceOnce(
  signing,
  "    exports: {\n      Address: typeof ergo.Address,\n      NetworkPrefix: ergo.NetworkPrefix,\n      defaultExport: 'default' in ergo,\n      init: 'init' in ergo,\n    },\n",
  '',
);
write('browserBuildTestUtils.ts', signing);
write(
  'browserFeeQuoteTestUtils.ts',
  replaceOnce(
    normalized('browserFeeQuoteTestUtils.ts'),
    "from '../src/index'",
    "from '@rosen-network/solana'",
  ),
);

/** Bundles the installed package and runs the synthetic fixture without Node globals or fetch. */
const runFixture = async (name, globalName) => {
  const output = await esbuild.build({
    absWorkingDir: consumer,
    entryPoints: [path.join(evidence, name)],
    nodePaths: [path.join(consumer, 'node_modules')],
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
    } else inputs.push(fs.realpathSync(path.resolve(consumer, item)));
  }
  assert(
    inputs.every((item) => isWithin(evidencePhysical, item) || isWithin(modulesPhysical, item)),
    'Bundle resolved a module outside this consumer and its fixtures',
  );
  assert(
    inputs.some((item) => isWithin(installedPhysical, item)),
    'Installed package was not bundled',
  );
  assert(
    inputs.every((item) => !isWithin(path.join(repository, 'src'), item)),
    'Source runtime overlay',
  );
  assert(inputs.every((item) => !item.replaceAll('\\', '/').includes('/ergo-lib-wasm-nodejs/')));
  let fetchCalls = 0;
  const context = createContext({
    TextEncoder,
    TextDecoder,
    WebAssembly,
    structuredClone,
    atob,
    btoa,
    console,
    setTimeout,
    clearTimeout,
    fetch: () => {
      fetchCalls += 1;
      throw new Error('NETWORK_FORBIDDEN');
    },
  });
  const bytes = output.outputFiles[0].contents;
  write(`${globalName}.js`, bytes);
  write(`${globalName}-metafile.json`, `${JSON.stringify(output.metafile, null, 2)}\n`);
  runInContext(output.outputFiles[0].text, context, { timeout: 10000 });
  const api = context[globalName];
  const result =
    globalName === 'SolanaInstalledFees'
      ? await api.runBrowserFeeQuoteChecks()
      : {
          addresses: Array.from(api.runBrowserAddressChecks()),
          ...(await api.runBrowserProbes('9fadVRGYyiSBCgD7QtZU13BfGoDyTQ1oX918P8py22MJuMEwSuo')),
        };
  assert.deepEqual(
    { ...result.absentGlobals },
    { Buffer: 'undefined', process: 'undefined', require: 'undefined' },
  );
  assert.equal(fetchCalls, 0);
  if (globalName === 'SolanaInstalledFees') assert.equal(result.checks, 21);
  else {
    assert.equal(result.addresses.length, 9);
    assert.equal(result.buildIdentityChecks, 15);
  }
  return { bundle: pin(bytes), disabledInputs, fetchCalls, result };
};

const signingResult = await runFixture('browserBuildTestUtils.ts', 'SolanaInstalledSigning');
const feeResult = await runFixture('browserFeeQuoteTestUtils.ts', 'SolanaInstalledFees');
assert.deepEqual(packagePins(installed), beforePackage, 'Installed package changed');
for (const [name, bytes] of originals)
  assert.deepEqual(
    fs.readFileSync(path.join(repository, 'tests', name)),
    bytes,
    'Repository fixture changed',
  );
const result = {
  success: true,
  controls: { addresses: 9, constructionAndSigning: 15, feesAndQuotedSigning: 21 },
  versions: { node: process.version, esbuild: esbuild.version },
  packageFiles: beforePackage,
  fixtures: names.map((name) => ({
    name,
    original: pin(originals.get(name)),
    adapted: pin(fs.readFileSync(path.join(evidence, name))),
  })),
  signing: signingResult,
  fees: feeResult,
};
write('result.json', `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(
  `${JSON.stringify({ success: true, controls: result.controls, packageFiles: beforePackage.length, result: pin(fs.readFileSync(path.join(evidence, 'result.json'))) })}\n`,
);
