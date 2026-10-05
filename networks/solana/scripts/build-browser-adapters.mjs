import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import * as esbuild from 'esbuild';

const root = process.cwd();
const requireFromRoot = createRequire(path.join(root, 'package.json'));
const outputArgument = process.argv.indexOf('--outdir');
const outdir = path.resolve(
  outputArgument < 0 ? path.join(root, 'dist') : process.argv[outputArgument + 1],
);
/** Hashes the exact published source or generated artifact bytes. */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const thirdPartySources = new Map();

/** Writes new output or verifies identical existing bytes without overwriting. */
const writeArtifact = (file, bytes) => {
  if (existsSync(file))
    assert(
      readFileSync(file).equals(Buffer.from(bytes)),
      `Stale generated artifact: clean before rebuilding changed inputs (${path.basename(file)})`,
    );
  else writeFileSync(file, bytes, { flag: 'wx' });
  return { file: path.basename(file), bytes: bytes.length, sha256: sha256(bytes) };
};

/** Captures the closest installed package and exact notices for emitted bytes. */
const captureThirdPartySource = (input) => {
  if (!input.replaceAll('\\', '/').includes('node_modules/')) return;
  let directory = path.dirname(
    path.resolve(root, input.replace(/^(wasm-bytes|wasm-wrapper):/, '')),
  );
  while (true) {
    const manifestPath = path.join(directory, 'package.json');
    if (existsSync(manifestPath)) {
      const manifestBytes = readFileSync(manifestPath);
      const manifest = JSON.parse(manifestBytes.toString('utf8'));
      if (typeof manifest.name === 'string' && typeof manifest.version === 'string') {
        const identity = `${manifest.name}@${manifest.version}:${sha256(manifestBytes)}`;
        if (thirdPartySources.has(identity)) return;
        assert(typeof manifest.license === 'string', `Missing license: ${manifest.name}`);
        const files = readdirSync(directory)
          .filter((file) => /^(LICEN[CS]E|COPYING|NOTICE)(\..*)?$/i.test(file))
          .sort()
          .map((file) => {
            const bytes = readFileSync(path.join(directory, file));
            return { file, bytes, sha256: sha256(bytes) };
          });
        assert(
          files.some((file) => /^(LICEN[CS]E|COPYING)(\..*)?$/i.test(file.file)),
          `Missing license text: ${manifest.name}`,
        );
        thirdPartySources.set(identity, {
          name: manifest.name,
          version: manifest.version,
          license: manifest.license,
          packageManifestSha256: sha256(manifestBytes),
          files,
        });
        return;
      }
    }
    const parent = path.dirname(directory);
    assert(parent !== directory, `Missing emitted package provenance: ${path.basename(input)}`);
    directory = parent;
  }
};

/** Finds a declared package in the workspace's installed npm dependency tree. */
const packageRoot = (name, expectedVersion) => {
  for (const base of requireFromRoot.resolve.paths(`${name}/package.json`)) {
    try {
      const directory = path.join(base, name);
      const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
      assert.equal(manifest.name, name);
      assert.equal(manifest.version, expectedVersion);
      return directory;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`Missing declared build dependency: ${name}@${expectedVersion}`);
};

assert.equal(esbuild.version, '0.25.10');
const ergo = packageRoot('ergo-lib-wasm-browser', '0.24.1');
const spl = packageRoot('@solana/spl-token', '0.4.14');
packageRoot('@solana/web3.js', '1.98.4');
packageRoot('buffer', '6.0.3');
const pins = {
  'ergo_lib_wasm_bg.wasm': '45e500a7d97f1b01476ce8c029564320245828cd17fa8730aa0233f6c9cc2b7b',
  'ergo_lib_wasm.js': '891ce112fb1e2811ef6ccbb7b9db22302add7722f376989b5e28452d143257cf',
  'ergo_lib_wasm_bg.js': '09b79150f2ae619aedd0d0bfffc5fd2e4c5812b29f4bb48645c89aad1601021a',
};
for (const [file, expected] of Object.entries(pins))
  assert.equal(sha256(readFileSync(path.join(ergo, file))), expected);
const module = new WebAssembly.Module(readFileSync(path.join(ergo, 'ergo_lib_wasm_bg.wasm')));
assert(
  WebAssembly.Module.imports(module).every(
    (item) => item.module === './ergo_lib_wasm_bg.js' && item.kind === 'function',
  ),
);
const exports = WebAssembly.Module.exports(module);
assert(exports.every((item) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(item.name)));

const wasmPlugin = {
  name: 'ergo-published-wasm',
  setup: (build) => {
    build.onResolve({ filter: /^ergo-lib-wasm-browser$/ }, () => ({
      path: path.join(ergo, 'ergo_lib_wasm.js'),
    }));
    build.onResolve({ filter: /\.wasm$/ }, (args) => ({
      path: path.resolve(args.resolveDir, args.path),
      namespace: args.namespace === 'wasm-wrapper' ? 'wasm-bytes' : 'wasm-wrapper',
    }));
    build.onLoad({ filter: /.*/, namespace: 'wasm-bytes' }, (args) => ({
      contents: readFileSync(args.path),
      loader: 'binary',
    }));
    build.onLoad({ filter: /.*/, namespace: 'wasm-wrapper' }, (args) => ({
      resolveDir: path.dirname(args.path),
      loader: 'js',
      contents: `import bytes from './${path.basename(args.path)}'; import * as imports from './ergo_lib_wasm_bg.js'; const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { './ergo_lib_wasm_bg.js': imports }); ${exports.map((item) => `export const ${item.name} = instance.exports.${item.name};`).join('\n')}`,
    }));
  },
};
const bufferPlugin = {
  name: 'lexical-sdk-buffer',
  setup: (build) => {
    build.onResolve({ filter: /^@solana\/spl-token$/ }, () => ({
      path: path.join(spl, 'lib', 'esm', 'index.js'),
    }));
    build.onResolve({ filter: /^sdk-buffer$/ }, () => ({
      path: 'sdk-buffer',
      namespace: 'sdk-buffer',
    }));
    build.onLoad({ filter: /.*/, namespace: 'sdk-buffer' }, () => ({
      contents: "export { Buffer } from 'buffer';",
      loader: 'js',
      resolveDir: root,
    }));
  },
};

/** Builds generated artifacts; their declared web3 import remains deduplicated. */
const generate = async (name, source, options) => {
  const result = await esbuild.build({
    stdin: { contents: source, resolveDir: root, sourcefile: `${name}-entry.ts`, loader: 'ts' },
    outfile: path.join(outdir, `${name}.mjs`),
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    bundle: true,
    minify: true,
    write: false,
    metafile: true,
    ...options,
  });
  assert(
    Object.values(result.metafile.outputs).every((output) =>
      output.imports.every(
        (item) => name === 'spl-token-browser' && item.path === '@solana/web3.js',
      ),
    ),
  );
  for (const output of Object.values(result.metafile.outputs))
    for (const [input, contribution] of Object.entries(output.inputs))
      if (contribution.bytesInOutput > 0) captureThirdPartySource(input);
  return result.outputFiles.map((file) => writeArtifact(file.path, file.contents));
};

mkdirSync(outdir, { recursive: true });
const results = [
  ...(await generate(
    'ergo-address-browser',
    "export { Address, NetworkPrefix } from 'ergo-lib-wasm-browser';",
    {
      plugins: [wasmPlugin],
      banner: {
        js: '/*! Generated Ergo adapter: bundled published glue with a synchronous wrapper; published WASM bytes are unchanged. See THIRD_PARTY_NOTICES.txt. */',
      },
    },
  )),
  ...(await generate(
    'spl-token-browser',
    "export { createTransferCheckedInstruction, TOKEN_PROGRAM_ID } from '@solana/spl-token';",
    {
      plugins: [bufferPlugin],
      inject: ['sdk-buffer'],
      external: ['@solana/web3.js'],
      banner: {
        js: '/*! Generated SPL adapter: published SDK code is bundled and minified with a lexical Buffer binding. See THIRD_PARTY_NOTICES.txt. */',
      },
    },
  )),
];
const sources = [...thirdPartySources.entries()]
  .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  .map(([, source]) => source);
const noticeParts = [
  Buffer.from(
    'Third-party components in the generated Solana browser adapters\n\nThe SPL adapter bundles and minifies published SDK code and binds Buffer lexically. The Ergo adapter embeds the original published WASM bytes with a generated synchronous wrapper.\n',
  ),
];
for (const source of sources)
  for (const file of source.files)
    noticeParts.push(
      Buffer.from(
        `\n===== ${source.name}@${source.version} — ${source.license} — ${file.file} =====\n`,
      ),
      file.bytes,
      Buffer.from('\n'),
    );
results.push(
  writeArtifact(path.join(outdir, 'THIRD_PARTY_NOTICES.txt'), Buffer.concat(noticeParts)),
);
const sourcePins = sources.map((source) => ({
  name: source.name,
  version: source.version,
  license: source.license,
  packageManifestSha256: source.packageManifestSha256,
  licenseFiles: source.files.map((file) => ({
    file: file.file,
    bytes: file.bytes.length,
    sha256: file.sha256,
  })),
}));
const manifestPath = path.join(outdir, 'browser-adapters.json');
const manifestBytes = Buffer.from(
  `${JSON.stringify({ esbuild: esbuild.version, publishedErgoSourcePins: pins, thirdPartySources: sourcePins, results }, null, 2)}\n`,
);
writeArtifact(manifestPath, manifestBytes);
process.stderr.write(`${JSON.stringify(results)}\n`);
