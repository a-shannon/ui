import { Buffer } from 'buffer';

import { PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import { decodeSolanaRpcMint, decodeSolanaRpcTokenAccount } from '@rosen-network/solana';

import {
  mintRecordFaultCases,
  ORIGINAL_SPL_PROGRAM_ID,
  tokenAmountCases,
  tokenRecordFaultCases,
  tokenStateCases,
} from './rpcAccountDecoderTestData';
import {
  expectDecoderError,
  mintAccountRecord,
  mintRecordWithFault,
  noncanonicalMintBase64,
  TEST_MINT,
  TEST_TOKEN_ACCOUNT,
  TEST_WALLET,
  tokenAccountRecord,
  tokenRecordWithFault,
  wrappedSolMint,
} from './rpcAccountDecoderTestUtils';

describe('decodeSolanaRpcTokenAccount', () => {
  /**
   * @target decodeSolanaRpcTokenAccount returns $name as raw bigint units
   * @dependencies a valid 165-byte initialized account with an amount above Number.MAX_SAFE_INTEGER
   * @scenario decode one account and inspect its exact amount, owner binding, and immutable result
   * @expected the amount stays an unscaled bigint and the complete decoded view is frozen
   */
  it.each(tokenAmountCases)(
    'decodeSolanaRpcTokenAccount returns $name as raw bigint units',
    ({ amount }) => {
      const account = tokenAccountRecord({
        amount,
        delegateTag: 1,
        closeAuthorityTag: 1,
      });
      const decoded = decodeSolanaRpcTokenAccount(TEST_TOKEN_ACCOUNT, account, TEST_WALLET);

      expect(decoded.amount).toEqual(amount);
      expect(decoded.mint).toEqual(TEST_MINT);
      expect(decoded.owner).toEqual(TEST_WALLET);
      expect(decoded.state).toEqual('initialized');
      expect(decoded.nativeReserve).toEqual(null);
      expect(Object.isFrozen(decoded)).toEqual(true);
    },
  );

  /**
   * @target decodeSolanaRpcTokenAccount preserves the $name
   * @dependencies complete original-program account layouts with state tags 1 and 2
   * @scenario decode initialized and frozen account bytes independently
   * @expected each state is retained in the immutable decoded account without balance filtering
   */
  it.each(tokenStateCases)(
    'decodeSolanaRpcTokenAccount preserves the $name',
    ({ stateTag, expected }) => {
      const decoded = decodeSolanaRpcTokenAccount(
        TEST_TOKEN_ACCOUNT,
        tokenAccountRecord({ stateTag }),
        TEST_WALLET,
      );

      expect(decoded.state).toEqual(expected);
    },
  );

  /**
   * @target decodeSolanaRpcTokenAccount reads the WSOL native reserve
   * @dependencies complete WSOL account bytes with native COption Some and a u64 reserve
   * @scenario decode a wrapped-SOL account whose native reserve is present
   * @expected the WSOL mint and raw native reserve are returned without scaling
   */
  it('decodeSolanaRpcTokenAccount reads the WSOL native reserve', () => {
    const decoded = decodeSolanaRpcTokenAccount(
      TEST_TOKEN_ACCOUNT,
      tokenAccountRecord({
        mint: wrappedSolMint(),
        nativeTag: 1,
        nativeReserve: 8_001n,
      }),
      TEST_WALLET,
    );

    expect(decoded.mint).toEqual(wrappedSolMint());
    expect(decoded.nativeReserve).toEqual(8_001n);
  });

  /**
   * @target decodeSolanaRpcTokenAccount rejects a different internal wallet owner
   * @dependencies a valid token account whose internal owner differs from the requested wallet
   * @scenario decode the complete account using a separate requested owner
   * @expected the decoder rejects the wallet-owner mismatch before returning account data
   */
  it('decodeSolanaRpcTokenAccount rejects a different internal wallet owner', () => {
    const otherWallet = new PublicKey(Buffer.alloc(32, 8)).toBase58();
    expectDecoderError(
      () => decodeSolanaRpcTokenAccount(TEST_TOKEN_ACCOUNT, tokenAccountRecord(), otherWallet),
      'SOLANA_ASSET_ACCOUNT_WALLET_OWNER_MISMATCH',
    );
  });

  /**
   * @target decodeSolanaRpcTokenAccount rejects invalid account and wallet keys
   * @dependencies one invalid queried account address and one invalid requested wallet key
   * @scenario isolate malformed base58 input at each public-key argument
   * @expected the account address and wallet receive their respective stable validation codes
   */
  it('decodeSolanaRpcTokenAccount rejects invalid account and wallet keys', () => {
    expectDecoderError(
      () => decodeSolanaRpcTokenAccount('0', tokenAccountRecord(), TEST_WALLET),
      'SOLANA_ASSET_ACCOUNT_ADDRESS_INVALID',
    );
    expectDecoderError(
      () => decodeSolanaRpcTokenAccount(TEST_TOKEN_ACCOUNT, tokenAccountRecord(), '0'),
      'SOLANA_ASSET_WALLET_INVALID',
    );
  });

  /**
   * @target decodeSolanaRpcTokenAccount rejects $name
   * @dependencies one independently corrupted account metadata or original-layout field per fixture
   * @scenario apply each named account fault to a valid 165-byte original-program record
   * @expected each fault fails with its exact account-layout or ownership error code
   */
  it.each(tokenRecordFaultCases)(
    'decodeSolanaRpcTokenAccount rejects $name',
    ({ fault, error }) => {
      expectDecoderError(
        () =>
          decodeSolanaRpcTokenAccount(
            TEST_TOKEN_ACCOUNT,
            tokenRecordWithFault(tokenAccountRecord(), fault),
            TEST_WALLET,
          ),
        error,
      );
    },
  );

  /**
   * @target decodeSolanaRpcTokenAccount refuses non-data account records without invoking getters
   * @dependencies account records with accessors, custom prototypes, symbols, or extra toJSON fields
   * @scenario validate record descriptors before reading provider-selected fields
   * @expected malformed record shapes fail without invoking any getter
   */
  it('decodeSolanaRpcTokenAccount refuses non-data account records without invoking getters', () => {
    const base = tokenAccountRecord();
    let getterCalls = 0;
    const accessor = { ...base };
    Object.defineProperty(accessor, 'owner', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return ORIGINAL_SPL_PROGRAM_ID;
      },
    });
    const customPrototype = Object.assign(Object.create({ inherited: true }), base);
    const symbolField = { ...base, [Symbol('provider-field')]: false };
    const toJsonField = { ...base, toJSON: () => base };

    for (const value of [accessor, customPrototype, symbolField, toJsonField]) {
      expectDecoderError(
        () => decodeSolanaRpcTokenAccount(TEST_TOKEN_ACCOUNT, value, TEST_WALLET),
        'SOLANA_ASSET_ACCOUNT_INVALID',
      );
    }
    expect(getterCalls).toEqual(0);
  });

  /**
   * @target decodeSolanaRpcTokenAccount rejects non-data base64 tuples
   * @dependencies sparse, accessor-backed, custom-prototype, symbolic, and extended provider data tuples
   * @scenario pass each malformed tuple while retaining an otherwise valid account record
   * @expected every noncanonical tuple fails with SOLANA_ASSET_ACCOUNT_DATA_INVALID
   */
  it('decodeSolanaRpcTokenAccount rejects non-data base64 tuples', () => {
    const base = tokenAccountRecord();
    const sparse = new Array(2);
    sparse[1] = 'base64';
    const accessor = [base.data[0], 'base64'] as unknown[];
    Object.defineProperty(accessor, '0', {
      enumerable: true,
      get: () => base.data[0],
    });
    const customPrototype = Object.setPrototypeOf([...base.data], {});
    const symbolField = Object.assign([...base.data], {
      [Symbol('tuple-field')]: true,
    });
    const extended = [...base.data, 'extra'];

    for (const data of [sparse, accessor, customPrototype, symbolField, extended]) {
      expectDecoderError(
        () => decodeSolanaRpcTokenAccount(TEST_TOKEN_ACCOUNT, { ...base, data }, TEST_WALLET),
        'SOLANA_ASSET_ACCOUNT_DATA_INVALID',
      );
    }
  });
});

describe('decodeSolanaRpcMint', () => {
  /**
   * @target decodeSolanaRpcMint returns decimals from an initialized mint
   * @dependencies an initialized 82-byte mint with exact supply u64 and valid COption headers
   * @scenario decode the mint after strict owner, executable, base64, length, and initialization checks
   * @expected the immutable result contains the queried mint address and stored decimal byte
   */
  it('decodeSolanaRpcMint returns decimals from an initialized mint', () => {
    const decoded = decodeSolanaRpcMint(
      TEST_MINT,
      mintAccountRecord({
        decimals: 6,
        supply: 18_446_744_073_709_551_615n,
        mintAuthorityTag: 1,
        freezeAuthorityTag: 1,
      }),
    );

    expect(decoded).toEqual({ address: TEST_MINT, decimals: 6 });
    expect(Object.isFrozen(decoded)).toEqual(true);
  });

  /**
   * @target decodeSolanaRpcMint rejects noncanonical base64 padding bits
   * @dependencies an 82-byte mint encoding whose unused final base64 bits are nonzero
   * @scenario preserve decoded byte length while changing only unused padding bits
   * @expected the noncanonical encoding is rejected as invalid account data
   */
  it('decodeSolanaRpcMint rejects noncanonical base64 padding bits', () => {
    const record = mintAccountRecord();
    expectDecoderError(
      () =>
        decodeSolanaRpcMint(TEST_MINT, {
          ...record,
          data: [noncanonicalMintBase64(), 'base64'],
        }),
      'SOLANA_ASSET_ACCOUNT_DATA_INVALID',
    );
  });

  /**
   * @target decodeSolanaRpcMint rejects $name
   * @dependencies one independently corrupted mint metadata or original-layout field per fixture
   * @scenario apply each named mint fault to a valid initialized 82-byte record
   * @expected each fault fails with its exact account-layout, option-tag, or initialization code
   */
  it.each(mintRecordFaultCases)('decodeSolanaRpcMint rejects $name', ({ fault, error }) => {
    expectDecoderError(
      () => decodeSolanaRpcMint(TEST_MINT, mintRecordWithFault(mintAccountRecord(), fault)),
      error,
    );
  });

  /**
   * @target decodeSolanaRpcMint rejects an invalid mint key
   * @dependencies a malformed base58 mint address and an otherwise valid original-program mint
   * @scenario decode the same valid account under an invalid address
   * @expected the decoder rejects the queried address with SOLANA_ASSET_MINT_INVALID
   */
  it('decodeSolanaRpcMint rejects an invalid mint key', () => {
    expectDecoderError(
      () => decodeSolanaRpcMint('0', mintAccountRecord()),
      'SOLANA_ASSET_MINT_INVALID',
    );
  });

  /**
   * @target decodeSolanaRpcMint rejects extra selected account fields
   * @dependencies a mint record with one forbidden provider field and the original token program owner
   * @scenario add an unexpected account field to a valid mint provider record
   * @expected the record is rejected before mint bytes are interpreted
   */
  it('decodeSolanaRpcMint rejects extra selected account fields', () => {
    expectDecoderError(
      () =>
        decodeSolanaRpcMint(TEST_MINT, {
          ...mintAccountRecord(),
          context: { slot: 1 },
        }),
      'SOLANA_ASSET_ACCOUNT_INVALID',
    );
  });
});
