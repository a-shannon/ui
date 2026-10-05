import { fileURLToPath } from 'node:url';
import { TextDecoder, TextEncoder } from 'node:util';
import { createContext, runInContext } from 'node:vm';

import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

import { validateSolanaLockTarget } from '@rosen-network/solana';

import { browserAddressTestData } from './browserBuildTestData';
import { captureTestProfile, ergoDestination, nativeProfile } from './testUtils';

describe('generated browser adapters', () => {
  /**
   * @target createSolanaRpcTransport, createSolanaRpcWalletReadProducer, createSolanaRpcFeeProducers and prepareSolanaLockFeeQuote composes actual RPC wallet and fee producers without Node globals
   * @dependencies exported runtime producers, bounded synthetic fetch, standard Web APIs and an isolated browser VM
   * @scenario price SOL/SPL exact messages and refuse selected-account insufficiency, context mismatch, null fee and a low fee context
   * @expected 44 named checks across six scenarios pass with no Node globals or external fetch calls
   */
  it('composes actual RPC wallet and fee producers without Node globals', async () => {
    const output = await build({
      entryPoints: [fileURLToPath(new URL('./browserRpcTestUtils.ts', import.meta.url))],
      bundle: true,
      platform: 'browser',
      format: 'iife',
      globalName: 'SolanaRpcBrowserFixture',
      target: 'es2022',
      write: false,
      metafile: true,
    });
    expect(
      Object.values(output.metafile.outputs).every((item) => item.imports.length === 0),
    ).toEqual(true);
    expect(
      Object.keys(output.metafile.inputs).some((item) => item.includes('ergo-lib-wasm-nodejs')),
    ).toEqual(false);
    let fetchCalls = 0;
    const context = createContext({
      TextEncoder,
      TextDecoder,
      Uint8Array,
      URL,
      Response,
      AbortController,
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
    runInContext(output.outputFiles[0].text, context, { timeout: 10000 });
    const result = await context.SolanaRpcBrowserFixture.runBrowserRpcChecks();
    expect(result.checks).toEqual(44);
    expect(result.scenarios).toEqual(6);
    expect(result.absentGlobals).toEqual({
      Buffer: 'undefined',
      process: 'undefined',
      require: 'undefined',
    });
    expect(fetchCalls).toEqual(0);
  });

  /**
   * @target readSolanaWalletBalance, selectSolanaSourceTokenAccount,
   *   isCurrentSolanaWalletSession and isCurrentSolanaWalletBalanceView preserve
   *   captured sessions and named raw account reads
   * @dependencies actual public session/read exports, synthetic providers and an isolated browser VM
   * @scenario retain odd bigint amounts, select one account, and refuse copied or revoked captures
   * @expected 21 named controls pass with no Node globals or network calls
   */
  it('preserve captured sessions and named raw account reads', async () => {
    const output = await build({
      entryPoints: [fileURLToPath(new URL('./browserSessionReadTestUtils.ts', import.meta.url))],
      bundle: true,
      platform: 'browser',
      format: 'iife',
      globalName: 'SolanaSessionReadFixture',
      target: 'es2022',
      write: false,
      metafile: true,
    });
    expect(
      Object.values(output.metafile.outputs).every((item) => item.imports.length === 0),
    ).toEqual(true);
    expect(
      Object.keys(output.metafile.inputs).some((item) => item.includes('ergo-lib-wasm-nodejs')),
    ).toEqual(false);
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
    runInContext(output.outputFiles[0].text, context, { timeout: 10000 });
    const result = await context.SolanaSessionReadFixture.runBrowserSessionReadChecks();
    expect(result.checkCount).toEqual(21);
    expect(result.rawNative).toEqual('9007199254740993');
    expect(result.rawSPL).toEqual('9007199254740995');
    expect(result.selectedSPL).toEqual('2');
    expect(result.absentGlobals).toEqual({
      Buffer: 'undefined',
      process: 'undefined',
      require: 'undefined',
    });
    expect(fetchCalls).toEqual(0);
  });

  /**
   * @target prepareSolanaLockFeeQuote, signSolanaLockFeeQuote,
   *   getSolanaLockFeeQuoteBuild, isCurrentSolanaLockFeeQuote,
   *   revalidateSolanaSignedLock and isCurrentSolanaSignedLock preserve quote
   *   ownership and freshness through synthetic signing
   * @dependencies actual quote/session/signer/parser modules, pinned browser adapters and isolated VM
   * @scenario prepare and sign SOL/SPL; reread unchanged wire; refuse unavailable fees and post-sign expiry
   * @expected 21 named consumer controls pass without Buffer, process, require or network access
   */
  it('preserve quote ownership and freshness through synthetic signing', async () => {
    const output = await build({
      entryPoints: [fileURLToPath(new URL('./browserFeeQuoteTestUtils.ts', import.meta.url))],
      bundle: true,
      platform: 'browser',
      format: 'iife',
      globalName: 'SolanaFeeBrowserFixture',
      target: 'es2022',
      write: false,
      metafile: true,
    });
    expect(
      Object.values(output.metafile.outputs).every((item) => item.imports.length === 0),
    ).toEqual(true);
    expect(
      Object.keys(output.metafile.inputs).some((item) => item.includes('ergo-lib-wasm-nodejs')),
    ).toEqual(false);
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
        throw new Error('NETWORK_FORBIDDEN');
      },
    });
    runInContext(output.outputFiles[0].text, context, { timeout: 10000 });
    const result = await context.SolanaFeeBrowserFixture.runBrowserFeeQuoteChecks();
    expect(result.checks).toEqual(21);
    expect(result.absentGlobals).toEqual({
      Buffer: 'undefined',
      process: 'undefined',
      require: 'undefined',
    });
  });

  /**
   * @target buildSolanaLockMessage, signSolanaLockTransaction and
   *   validateSolanaLockTarget preserve source lock validation and signing
   *   without Node globals
   * @dependencies
   * - actual generated WASM/SPL artifacts, esbuild browser bundler and isolated VM
   * - synthetic deterministic Solana keys; no connectors or network requests
   * @scenario
   * - bundle the actual source lock producer and run SOL/SPL signing and capture negatives
   * - compare mainnet/testnet, invalid checksum and malformed destinations with known outcomes
   * @expected
   * - no unresolved imports or Node WASM module; captures, message bytes and signatures remain valid
   */
  it('preserve source lock validation and signing without Node globals', async () => {
    const output = await build({
      entryPoints: [fileURLToPath(new URL('./browserBuildTestUtils.ts', import.meta.url))],
      bundle: true,
      platform: 'browser',
      format: 'iife',
      globalName: 'SolanaBrowserFixture',
      target: 'es2022',
      write: false,
      metafile: true,
    });
    expect(
      Object.values(output.metafile.outputs).every((item) => item.imports.length === 0),
    ).toEqual(true);
    expect(
      Object.keys(output.metafile.inputs).some((item) => item.includes('ergo-lib-wasm-nodejs')),
    ).toEqual(false);
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
    });
    runInContext(output.outputFiles[0].text, context, { timeout: 10000 });
    const api = context.SolanaBrowserFixture;
    const result = await api.runBrowserProbes(ergoDestination);
    expect(result.absentGlobals).toEqual({
      Buffer: 'undefined',
      process: 'undefined',
      require: 'undefined',
    });
    expect(Array.from(result.builds, (item: { wireBytes: number }) => item.wireBytes > 0)).toEqual([
      true,
      true,
    ]);
    const oracle = browserAddressTestData.map(({ address, network }) => {
      try {
        validateSolanaLockTarget(address, captureTestProfile(nativeProfile().assets, network));
        return true;
      } catch {
        return false;
      }
    });
    expect(oracle).toEqual(browserAddressTestData.map((item) => item.accepted));
    expect(Array.from(api.runBrowserAddressChecks())).toEqual(oracle);
  });
});
