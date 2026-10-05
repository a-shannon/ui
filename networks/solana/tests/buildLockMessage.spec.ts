import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { SystemProgram } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import {
  buildSolanaLockMessage,
  getSolanaLockBuildEvidence,
  hasCapturedSolanaLockMessage,
  SOLANA_MEMO_PROGRAM_ID,
  SOLANA_NATIVE_ASSET,
} from '@rosen-network/solana';

import {
  captureTestProfile,
  ergoDestination,
  keypair,
  nativeProfile,
  splProfile,
} from './testUtils';

describe('buildSolanaLockMessage', () => {
  /**
   * @target buildSolanaLockMessage rejects a nonprimitive asset before coercion
   * @dependencies caller-owned object with mutable asset coercion methods
   * @scenario supply an object that would encode and look up the native SOL key
   * @expected reject before coercion so no caller-owned object enters captured evidence
   */
  it('rejects a nonprimitive asset before coercion', () => {
    let coercions = 0;
    const asset = {
      /** Models a caller-owned property lookup that impersonates a native key. */
      [Symbol.toPrimitive]: () => {
        coercions++;
        return 'SOL';
      },
      /** Models Memo JSON output differing from the object's stored identity. */
      toJSON: () => 'SOL',
    };
    expect(() =>
      buildSolanaLockMessage(nativeProfile(), {
        asset: asset as unknown as string,
        grossAmount: '1000000',
        destinationAddress: ergoDestination,
        senderAddress: keypair(113).publicKey.toBase58(),
        recentBlockhash: keypair(121).publicKey.toBase58(),
      }),
    ).toThrow(TypeError);
    expect(coercions).toEqual(0);
  });

  /**
   * @target buildSolanaLockMessage rejects inherited native asset policies
   * @dependencies SPL-only captured allowlist and temporary inherited SOL policy
   * @scenario place a valid native policy on Object.prototype without adding it to the captured allowlist
   * @expected reject SOL as unlisted; restore the isolated prototype fixture afterward
   */
  it('rejects inherited native asset policies', () => {
    const mint = keypair(127).publicKey.toBase58();
    const profile = splProfile(mint, keypair(137).publicKey.toBase58());
    const inheritedPolicy = nativeProfile().assets.SOL;
    expect(Object.hasOwn(profile.assets, 'SOL')).toEqual(false);
    expect(Object.getOwnPropertyDescriptor(Object.prototype, 'SOL')).toEqual(undefined);
    Object.defineProperty(Object.prototype, 'SOL', {
      configurable: true,
      value: inheritedPolicy,
    });
    try {
      expect(() =>
        buildSolanaLockMessage(profile, {
          asset: 'SOL',
          grossAmount: '1000000',
          destinationAddress: ergoDestination,
          senderAddress: keypair(113).publicKey.toBase58(),
          recentBlockhash: keypair(121).publicKey.toBase58(),
        }),
      ).toThrow(TypeError);
    } finally {
      Reflect.deleteProperty(Object.prototype, 'SOL');
    }
  });

  /**
   * @target buildSolanaLockMessage builds one native transfer followed by Memo v1
   * @dependencies
   * - web3.js message compiler and captured profile; no mocks
   * @scenario
   * - build a legacy SOL lock with synthetic sender, vault and blockhash
   * - inspect the compiled instructions and Memo JSON key order
   * @expected
   * - the message has exactly one System Program transfer then one Memo
   */
  it('builds one native transfer followed by Memo v1', () => {
    const profile = nativeProfile();
    const sender = keypair(113);
    const build = buildSolanaLockMessage(profile, {
      asset: SOLANA_NATIVE_ASSET,
      grossAmount: '1000000',
      destinationAddress: ergoDestination,
      senderAddress: sender.publicKey.toBase58(),
      recentBlockhash: keypair(121).publicKey.toBase58(),
    });
    const message = build.transaction.compileMessage();
    const memoIx = build.transaction.instructions[1];

    expect(message.instructions).toHaveLength(2);
    expect(
      message.accountKeys[message.instructions[0].programIdIndex].equals(SystemProgram.programId),
    ).toEqual(true);
    expect(
      message.accountKeys[message.instructions[1].programIdIndex].toBase58() ===
        SOLANA_MEMO_PROGRAM_ID,
    ).toEqual(true);
    expect(Object.keys(JSON.parse(memoIx.data.toString('utf8')))).toEqual([
      'v',
      'toChain',
      'toAddress',
      'asset',
      'amount',
      'networkFee',
      'bridgeFee',
    ]);
    expect(JSON.parse(memoIx.data.toString('utf8'))).toEqual({
      v: 1,
      toChain: 'ergo',
      toAddress: ergoDestination,
      asset: 'SOL',
      amount: '1000000',
      networkFee: '100',
      bridgeFee: '200',
    });
    expect(hasCapturedSolanaLockMessage(build)).toEqual(true);
    expect(
      build.transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).length,
    ).toBeLessThanOrEqual(1232);
  });

  /**
   * @target buildSolanaLockMessage builds TransferChecked for an allowlisted original SPL mint
   * @dependencies
   * - @solana/spl-token instruction encoder; no mocks
   * @scenario
   * - capture one synthetic original SPL mint and vault token account
   * - build a lock from another synthetic source token account
   * - inspect the payment program and Memo asset identity
   * - attempt an unlisted mint
   * @expected
   * - only the allowlisted mint produces a payment message
   */
  it('builds TransferChecked for an allowlisted original SPL mint', () => {
    const mint = keypair(127).publicKey.toBase58();
    const source = keypair(131).publicKey.toBase58();
    const vaultToken = keypair(137).publicKey.toBase58();
    const profile = splProfile(mint, vaultToken);
    const sender = keypair(139);
    const build = buildSolanaLockMessage(profile, {
      asset: mint,
      grossAmount: '1000000',
      destinationAddress: ergoDestination,
      senderAddress: sender.publicKey.toBase58(),
      recentBlockhash: keypair(149).publicKey.toBase58(),
      sourceTokenAccount: source,
    });
    const message = build.transaction.compileMessage();
    const memo = JSON.parse(build.memo) as Record<string, unknown>;

    expect(
      message.accountKeys[message.instructions[0].programIdIndex].equals(TOKEN_PROGRAM_ID),
    ).toEqual(true);
    expect(memo.asset).toEqual(mint);
    expect(memo.amount).toEqual('1000000');
    expect(hasCapturedSolanaLockMessage(build)).toEqual(true);
    expect(() =>
      buildSolanaLockMessage(profile, {
        asset: keypair(151).publicKey.toBase58(),
        grossAmount: '1000000',
        destinationAddress: ergoDestination,
        senderAddress: sender.publicKey.toBase58(),
        recentBlockhash: keypair(149).publicKey.toBase58(),
        sourceTokenAccount: source,
      }),
    ).toThrow();
  });

  /**
   * @target buildSolanaLockMessage rejects invalid targets, limits, and unvalidated caller data
   * @dependencies
   * - captured profile and Ergo address parser; no mocks
   * @scenario
   * - vary the target, gross amount, optional fields and profile capture
   * - try an amount outside the u64 range and the configured minimum
   * @expected
   * - each invalid request fails before it can be signed
   */
  it('rejects invalid targets, limits, and unvalidated caller data', () => {
    const profile = nativeProfile();
    const sender = keypair(157);
    const request = {
      asset: 'SOL',
      grossAmount: '1000',
      destinationAddress: ergoDestination,
      senderAddress: sender.publicKey.toBase58(),
      recentBlockhash: keypair(163).publicKey.toBase58(),
    };
    expect(() => buildSolanaLockMessage(profile, { ...request, grossAmount: '0' })).toThrow();
    expect(() =>
      buildSolanaLockMessage(profile, {
        ...request,
        grossAmount: '18446744073709551616',
      }),
    ).toThrow();
    expect(() => buildSolanaLockMessage(profile, { ...request, grossAmount: '300' })).toThrow();
    expect(() =>
      buildSolanaLockMessage(profile, { ...request, destinationAddress: 'not-ergo' }),
    ).toThrow();
    expect(() => buildSolanaLockMessage(profile, { ...request, recentBlockhash: 'bad' })).toThrow();
    expect(() =>
      buildSolanaLockMessage(profile, { ...request, unexpected: true } as never),
    ).toThrow();
    expect(() => buildSolanaLockMessage({ ...profile } as never, request)).toThrow();
    expect(() =>
      buildSolanaLockMessage(profile, {
        ...request,
        sourceTokenAccount: keypair(167).publicKey.toBase58(),
      }),
    ).toThrow();
  });

  /**
   * @target buildSolanaLockMessage preserves wide source amounts without rounding
   * @dependencies
   * - actual System Program encoder and captured native profile; no mocks
   * @scenario
   * - build a transfer above Number.MAX_SAFE_INTEGER within Ergo signed range
   * - decode the encoded little-endian u64 and inspect the Memo amount
   * @expected
   * - both encodings retain the exact requested amount
   */
  it('preserves wide source amounts without rounding', () => {
    const policy = nativeProfile().assets.SOL;
    const profile = captureTestProfile({
      SOL: { ...policy, maximumGrossAmount: '9223372036854775807' },
    });
    const build = buildSolanaLockMessage(profile, {
      asset: 'SOL',
      grossAmount: '9007199254740993',
      destinationAddress: ergoDestination,
      senderAddress: keypair(113).publicKey.toBase58(),
      recentBlockhash: keypair(121).publicKey.toBase58(),
    });
    expect(build.transaction.instructions[0].data.readBigUInt64LE(4)).toEqual(9007199254740993n);
    expect(JSON.parse(build.memo).amount).toEqual('9007199254740993');
  });

  /**
   * @target buildSolanaLockMessage rejects destination mapping dust in the request
   * @dependencies
   * - captured exact-decimal SPL policy and actual instruction encoder; no mocks
   * @scenario
   * - capture representable limits and fees with fewer destination decimals
   * - request one gross amount containing a nonrepresentable remainder
   * @expected
   * - construction fails on loss of destination units
   */
  it('rejects destination mapping dust in the request', () => {
    const mint = keypair(127).publicKey.toBase58();
    const policy = splProfile(mint, keypair(137).publicKey.toBase58()).assets[mint];
    const profile = captureTestProfile({
      [mint]: {
        ...policy,
        sourceDecimals: 9,
        destinationDecimals: 6,
        networkFee: '1000',
        bridgeFee: '2000',
        minimumGrossAmount: '10000',
      },
    });
    expect(() =>
      buildSolanaLockMessage(profile, {
        asset: mint,
        grossAmount: '10001',
        destinationAddress: ergoDestination,
        senderAddress: keypair(113).publicKey.toBase58(),
        recentBlockhash: keypair(121).publicKey.toBase58(),
        sourceTokenAccount: keypair(131).publicKey.toBase58(),
      }),
    ).toThrow(RangeError);
  });
});

describe('hasCapturedSolanaLockMessage', () => {
  /**
   * @target hasCapturedSolanaLockMessage detects post-construction payment mutation
   * @dependencies
   * - web3.js legacy transaction mutation; no mocks
   * @scenario
   * - change one byte of the payment instruction after construction
   * - compare the message with the captured compiled bytes
   * @expected
   * - the message identity check returns false
   */
  it('detects post-construction payment mutation', () => {
    const build = buildSolanaLockMessage(nativeProfile(), {
      asset: 'SOL',
      grossAmount: '1000000',
      destinationAddress: ergoDestination,
      senderAddress: keypair(173).publicKey.toBase58(),
      recentBlockhash: keypair(179).publicKey.toBase58(),
    });
    build.transaction.instructions[0].data[4] ^= 1;

    expect(hasCapturedSolanaLockMessage(build)).toEqual(false);
  });
});

describe('getSolanaLockBuildEvidence', () => {
  /**
   * @target getSolanaLockBuildEvidence returns detached message evidence
   * @dependencies
   * - actual builder WeakMap evidence and web3.js message compiler; no mocks
   * @scenario
   * - modify the returned evidence bytes and then alter the payment message
   * @expected
   * - caller changes cannot replace the builder's original captured bytes
   */
  it('returns detached message evidence', () => {
    const build = buildSolanaLockMessage(nativeProfile(), {
      asset: 'SOL',
      grossAmount: '1000000',
      destinationAddress: ergoDestination,
      senderAddress: keypair(113).publicKey.toBase58(),
      recentBlockhash: keypair(121).publicKey.toBase58(),
    });
    const evidence = getSolanaLockBuildEvidence(build);
    evidence?.messageBytes.fill(0);
    expect(hasCapturedSolanaLockMessage(build)).toEqual(true);
    build.transaction.instructions[0].data[4] ^= 1;
    expect(hasCapturedSolanaLockMessage(build)).toEqual(false);
    expect(getSolanaLockBuildEvidence({ ...build })).toEqual(undefined);
  });
});
