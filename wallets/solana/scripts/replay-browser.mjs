import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import * as esbuild from 'esbuild';

/** Selects an explicit Chrome executable or a standard installed Chrome/Chromium. */
const selectBrowser = () => {
  const explicit = process.env.SOLANA_BROWSER_EXECUTABLE;
  if (explicit) {
    assert(existsSync(explicit), 'SOLANA_BROWSER_EXECUTABLE does not exist');
    return explicit;
  }
  const candidates = (process.env.PATH ?? '')
    .split(path.delimiter)
    .flatMap((directory) =>
      ['chrome', 'chromium', 'chromium-browser'].map((name) => path.join(directory, name)),
    );
  for (const base of [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA,
  ])
    if (base) candidates.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  const found = candidates.find((candidate) => existsSync(candidate));
  assert(
    found,
    'Install Chrome/Chromium or set SOLANA_BROWSER_EXECUTABLE for this optional replay',
  );
  return found;
};

const directory = mkdtempSync(path.join(tmpdir(), 'solana-browser-replay-'));
const bundle = await esbuild.build({
  entryPoints: [path.resolve('tests/browserBuildTestUtils.ts')],
  outfile: path.join(directory, 'browser.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'SolanaBrowserFixture',
  target: 'es2022',
  metafile: true,
});
assert(Object.values(bundle.metafile.outputs).every((output) => output.imports.length === 0));
assert(Object.keys(bundle.metafile.inputs).every((file) => !file.includes('ergo-lib-wasm-nodejs')));
const destination = '9fadVRGYyiSBCgD7QtZU13BfGoDyTQ1oX918P8py22MJuMEwSuo';
const html = `<!doctype html><meta charset="utf-8"><pre id="result">pending</pre><script>const initStart=performance.now();</script><script src="./browser.js"></script><script>(async()=>{try{const initMilliseconds=performance.now()-initStart; const addresses=SolanaBrowserFixture.runBrowserAddressChecks(); const outcome=await SolanaBrowserFixture.runBrowserProbes(${JSON.stringify(destination)}); document.getElementById('result').textContent=JSON.stringify({success:true,userAgent:navigator.userAgent,initMilliseconds,addresses,outcome});}catch(error){document.getElementById('result').textContent=JSON.stringify({success:false,error:String(error)});}})();</script>`;
const page = path.join(directory, 'browser.html');
writeFileSync(page, html, { flag: 'wx' });
const browser = spawnSync(
  selectBrowser(),
  [
    '--headless=new',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${path.join(directory, 'profile')}`,
    '--dump-dom',
    '--virtual-time-budget=10000',
    pathToFileURL(page).href,
  ],
  { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 ** 2 },
);
writeFileSync(path.join(directory, 'chrome-stdout.html'), browser.stdout ?? '', { flag: 'wx' });
writeFileSync(path.join(directory, 'chrome-stderr.log'), browser.stderr ?? '', { flag: 'wx' });
assert(!browser.error, String(browser.error));
assert.equal(browser.status, 0, browser.stderr);
const text = /<pre id="result">([\s\S]*?)<\/pre>/.exec(browser.stdout)?.[1];
assert(text && text !== 'pending', 'Browser replay did not finish');
const result = JSON.parse(
  text.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>'),
);
assert.equal(result.success, true, result.error);
const resultPath = path.join(directory, 'result.json');
writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
assert.deepEqual(JSON.parse(readFileSync(resultPath, 'utf8')), result);
process.stdout.write(`${JSON.stringify(result)}\n`);
