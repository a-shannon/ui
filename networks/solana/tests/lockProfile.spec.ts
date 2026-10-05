import { describe, expect, it } from 'vitest';

import { captureSolanaLockProfile, validateSolanaLockTarget } from '@rosen-network/solana';

import {
  captureTestProfile,
  ergoDestination,
  keypair,
  nativeProfile,
  testErgoAddressForNetwork,
} from './testUtils';

describe('captureSolanaLockProfile', () => {
  /**
   * @target captureSolanaLockProfile reads caller configuration once before validation
   * @dependencies
   * - actual structuredClone and canonical public-key validation; no mocks
   * @scenario
   * - supply a vault getter that changes value after its first read
   * - capture the profile and inspect the selected vault
   * @expected
   * - the validated first value is captured and later getter values are ignored
   */
  it('reads caller configuration once before validation', () => {
    let reads = 0;
    const profile = captureSolanaLockProfile({
      ...nativeProfile(),
      get vaultOwner() {
        reads += 1;
        return reads === 1 ? keypair(41).publicKey.toBase58() : 'invalid-vault';
      },
    });
    expect(reads).toEqual(1);
    expect(profile.vaultOwner).toEqual(keypair(41).publicKey.toBase58());
  });

  /**
   * @target captureSolanaLockProfile rejects range overflow and noncanonical source units (%s)
   * @dependencies
   * - actual profile capture and bounded integer parser; no mocks
   * @scenario
   * - replace only the maximum amount in an otherwise valid native policy
   * @expected
   * - an unrepresentable or noncanonical maximum is rejected
   */
  it.each(['18446744073709551616', '9223372036854775808', '01', '1e10'])(
    'rejects range overflow and noncanonical source units (%s)',
    (maximumGrossAmount) => {
      expect(() =>
        captureTestProfile({ SOL: { ...nativeProfile().assets.SOL, maximumGrossAmount } }),
      ).toThrow(Error);
    },
  );
  /**
   * @target captureSolanaLockProfile captures an immutable copy of the asset policy
   * @dependencies
   * - Solana PublicKey and Ergo network parsers; no mocks
   * @scenario
   * - capture one synthetic mint and exact amounts, fees and decimals
   * - mutate the caller-owned policy
   * - inspect the captured profile and nested policy
   * @expected
   * - the profile preserves original values and is deeply frozen
   */
  it('captures an immutable copy of the asset policy', () => {
    const mint = keypair(53).publicKey.toBase58();
    const sourcePolicy = {
      kind: 'spl' as const,
      sourceDecimals: 6,
      destinationDecimals: 6,
      destinationTokenId: 'ab'.repeat(32),
      minimumGrossAmount: '1000',
      maximumGrossAmount: '100000000',
      networkFee: '100',
      bridgeFee: '200',
      vaultTokenAccount: keypair(67).publicKey.toBase58(),
    };
    const profile = captureTestProfile({ [mint]: sourcePolicy });
    sourcePolicy.networkFee = '900';

    expect(profile.assets[mint].networkFee).toEqual('100');
    expect(Object.isFrozen(profile)).toEqual(true);
    expect(Object.isFrozen(profile.assets)).toEqual(true);
    expect(Object.isFrozen(profile.assets[mint])).toEqual(true);
  });

  /**
   * @target captureSolanaLockProfile rejects unsupported assets, invalid limits, and fee mapping dust
   * @dependencies
   * - Solana PublicKey parser; no mocks
   * @scenario
   * - supply a wrapped-SOL mint
   * - supply fee bounds exhausting the minimum amount
   * - first prove the otherwise-valid SPL policy can be captured
   * - vary network and bridge fee dust independently
   * @expected
   * - each unsupported or nonrepresentable policy is rejected
   */
  it('rejects unsupported assets, invalid limits, and fee mapping dust', () => {
    const valid = {
      kind: 'spl' as const,
      sourceDecimals: 9,
      destinationDecimals: 6,
      destinationTokenId: 'ab'.repeat(32),
      minimumGrossAmount: '10000',
      maximumGrossAmount: '100000',
      networkFee: '1000',
      bridgeFee: '2000',
      vaultTokenAccount: keypair(71).publicKey.toBase58(),
    };
    expect(() => captureTestProfile({ [keypair(81).publicKey.toBase58()]: valid })).not.toThrow();
    expect(() =>
      captureTestProfile({
        So11111111111111111111111111111111111111112: valid,
      }),
    ).toThrow();
    expect(() =>
      captureTestProfile({
        [keypair(81).publicKey.toBase58()]: {
          ...valid,
          minimumGrossAmount: '3000',
        },
      }),
    ).toThrow();
    expect(() =>
      captureTestProfile({
        [keypair(91).publicKey.toBase58()]: { ...valid, networkFee: '101' },
      }),
    ).toThrow(RangeError);
    expect(() =>
      captureTestProfile({
        [keypair(91).publicKey.toBase58()]: { ...valid, bridgeFee: '201' },
      }),
    ).toThrow(RangeError);
  });
});

describe('validateSolanaLockTarget', () => {
  /**
   * @target validateSolanaLockTarget checks the target against the captured Ergo network
   * @dependencies
   * - ergo-lib-wasm-nodejs address parser; no mocks
   * @scenario
   * - capture mainnet and testnet profiles
   * - validate the fixture address on both networks
   * - validate a mainnet address against the testnet profile
   * @expected
   * - matching networks pass and a mismatched network is rejected
   */
  it('checks the target against the captured Ergo network', () => {
    const native = {
      SOL: {
        kind: 'native' as const,
        sourceDecimals: 9,
        destinationDecimals: 9,
        destinationTokenId: 'cd'.repeat(32),
        minimumGrossAmount: '1000',
        maximumGrossAmount: '1000000',
        networkFee: '100',
        bridgeFee: '200',
      },
    };
    const mainnet = captureTestProfile(native);
    const testnet = captureTestProfile(native, 'testnet');
    expect(() => validateSolanaLockTarget(ergoDestination, mainnet)).not.toThrow();
    expect(() =>
      validateSolanaLockTarget(testErgoAddressForNetwork('testnet'), testnet),
    ).not.toThrow();
    expect(() => validateSolanaLockTarget(ergoDestination, testnet)).toThrow();
  });
});
