import { Buffer } from 'buffer';

import { describe, expect, it, vi } from 'vitest';

import type { SolanaLockFeeProducers } from '@rosen-network/solana';

import {
  EXPECTED_GENESIS_HASH,
  invalidBlockHeightCases,
  invalidFloorCases,
  MIN_CONTEXT_SLOT,
  OTHER_GENESIS_HASH,
  TEST_ADDRESS,
  TEST_BLOCKHASH,
  U64_MAX,
} from './rpcFeeProducersTestData';
import {
  contextualResult,
  createFeeProducerFixture,
  expectProducerError,
} from './rpcFeeProducersTestUtils';

/** Builds the finalized request fields shared by fee-producer test scenarios. */
const finalizedRequest = (minContextSlot: bigint = MIN_CONTEXT_SLOT) => ({
  clusterGenesisHash: EXPECTED_GENESIS_HASH,
  commitment: 'finalized' as const,
  minContextSlot,
});

describe('createSolanaRpcFeeProducers', () => {
  /**
   * @target createSolanaRpcFeeProducers captures six callbacks and emits exact finalized or confirmed request shapes
   * @dependencies one deterministic local transport, one captured balance callback, and exact raw JSON results
   * @scenario invoke balance, blockhash, payer, rent, fee, and confirmed height reads on one producer instance
   * @expected each operation has a before/after genesis check, exact method parameters, raw bigint DTOs, and no fabricated scalar context
   */
  it('captures six callbacks and emits exact finalized or confirmed request shapes', async () => {
    const readBalanceResult = Object.freeze({
      address: TEST_ADDRESS,
      clusterGenesisHash: EXPECTED_GENESIS_HASH,
      commitment: 'finalized',
      nativeContextSlot: MIN_CONTEXT_SLOT,
      tokenContextSlot: MIN_CONTEXT_SLOT,
      nativeBalance: U64_MAX,
      tokenAccounts: Object.freeze([]),
    });
    const fixture = createFeeProducerFixture({
      readBalance: async (request) => {
        expect(Object.isFrozen(request)).toEqual(true);
        fixture.balanceCalls.push(request);
        return readBalanceResult;
      },
    });
    const balanceRequest = {
      address: TEST_ADDRESS,
      ...finalizedRequest(),
    };
    const balance = await fixture.producers.readBalance(balanceRequest);
    const blockhash = await fixture.producers.readLatestBlockhash(finalizedRequest());
    const payer = await fixture.producers.readFeePayer({
      ...finalizedRequest(),
      address: TEST_ADDRESS,
    });
    const rent = await fixture.producers.readRentMinimum({
      clusterGenesisHash: EXPECTED_GENESIS_HASH,
      commitment: 'finalized',
      dataLength: 0,
    });
    const fee = await fixture.producers.readMessageFee({
      ...finalizedRequest(),
      messageBase64: 'AQIDBA==',
    });
    const height = await fixture.producers.readBlockHeight({
      clusterGenesisHash: EXPECTED_GENESIS_HASH,
      commitment: 'confirmed',
      minContextSlot: MIN_CONTEXT_SLOT,
    });

    expect(balance).toBe(readBalanceResult);
    expect(blockhash).toEqual({
      clusterGenesisHash: EXPECTED_GENESIS_HASH,
      commitment: 'finalized',
      contextSlot: MIN_CONTEXT_SLOT,
      blockhash: TEST_BLOCKHASH,
      lastValidBlockHeight: U64_MAX,
    });
    expect(payer).toEqual({
      clusterGenesisHash: EXPECTED_GENESIS_HASH,
      commitment: 'finalized',
      contextSlot: MIN_CONTEXT_SLOT,
      address: TEST_ADDRESS,
      owner: TEST_ADDRESS,
      executable: false,
      dataBase64: '',
      lamports: 9_007_199_254_740_993n,
    });
    expect(rent).toEqual({
      clusterGenesisHash: EXPECTED_GENESIS_HASH,
      commitment: 'finalized',
      dataLength: 0,
      minimumLamports: U64_MAX,
    });
    expect(fee).toEqual({
      clusterGenesisHash: EXPECTED_GENESIS_HASH,
      commitment: 'finalized',
      contextSlot: MIN_CONTEXT_SLOT,
      messageBase64: 'AQIDBA==',
      feeLamports: 0n,
    });
    expect(height).toEqual({
      clusterGenesisHash: EXPECTED_GENESIS_HASH,
      commitment: 'confirmed',
      blockHeight: 9_007_199_254_740_993n,
    });
    expect(Object.isFrozen(blockhash)).toEqual(true);
    expect(Object.isFrozen(payer)).toEqual(true);
    expect(Object.isFrozen(rent)).toEqual(true);
    expect(Object.isFrozen(fee)).toEqual(true);
    expect(Object.isFrozen(height)).toEqual(true);
    expect(fixture.balanceCalls).toEqual([balanceRequest]);
    expect(fixture.requests.map(({ method }) => method)).toEqual([
      'getGenesisHash',
      'getGenesisHash',
      'getGenesisHash',
      'getLatestBlockhash',
      'getGenesisHash',
      'getGenesisHash',
      'getAccountInfo',
      'getGenesisHash',
      'getGenesisHash',
      'getMinimumBalanceForRentExemption',
      'getGenesisHash',
      'getGenesisHash',
      'getFeeForMessage',
      'getGenesisHash',
      'getGenesisHash',
      'getBlockHeight',
      'getGenesisHash',
    ]);
    expect(fixture.requests.map(({ id }) => id)).toEqual(
      Array.from({ length: fixture.requests.length }, (_, index) => index + 1),
    );
    expect(fixture.requests[3].params).toEqual([
      { commitment: 'finalized', minContextSlot: MIN_CONTEXT_SLOT },
    ]);
    expect(Object.isFrozen(fixture.requests[3].params[0])).toEqual(true);
    expect(fixture.requests[6].params).toEqual([
      TEST_ADDRESS,
      { commitment: 'finalized', encoding: 'base64', minContextSlot: MIN_CONTEXT_SLOT },
    ]);
    expect(fixture.requests[9].params).toEqual([0, { commitment: 'finalized' }]);
    expect(fixture.requests[12].params).toEqual([
      'AQIDBA==',
      { commitment: 'finalized', minContextSlot: MIN_CONTEXT_SLOT },
    ]);
    expect(fixture.requests[15].params).toEqual([
      { commitment: 'confirmed', minContextSlot: MIN_CONTEXT_SLOT },
    ]);
  });

  /**
   * @target createSolanaRpcFeeProducers checks the configured genesis before each of the six callback reads
   * @dependencies each of the six callback shapes and a first-observation cluster mismatch
   * @scenario invoke one callback at a time with an observed genesis hash different from configuration
   * @expected the mismatch is reported before balance delegation or any data RPC method is called
   */
  it('checks the configured genesis before each of the six callback reads', async () => {
    const invoke = [
      (f: ReturnType<typeof createFeeProducerFixture>) =>
        f.producers.readBalance({ address: TEST_ADDRESS, ...finalizedRequest() }),
      (f: ReturnType<typeof createFeeProducerFixture>) =>
        f.producers.readLatestBlockhash(finalizedRequest()),
      (f: ReturnType<typeof createFeeProducerFixture>) =>
        f.producers.readFeePayer({ ...finalizedRequest(), address: TEST_ADDRESS }),
      (f: ReturnType<typeof createFeeProducerFixture>) =>
        f.producers.readRentMinimum({
          clusterGenesisHash: EXPECTED_GENESIS_HASH,
          commitment: 'finalized',
          dataLength: 0,
        }),
      (f: ReturnType<typeof createFeeProducerFixture>) =>
        f.producers.readMessageFee({ ...finalizedRequest(), messageBase64: 'AQ==' }),
      (f: ReturnType<typeof createFeeProducerFixture>) =>
        f.producers.readBlockHeight({
          clusterGenesisHash: EXPECTED_GENESIS_HASH,
          commitment: 'confirmed',
          minContextSlot: MIN_CONTEXT_SLOT,
        }),
    ];
    for (const read of invoke) {
      const fixture = createFeeProducerFixture({ genesisValues: [OTHER_GENESIS_HASH] });
      await expectProducerError(() => read(fixture), 'SOLANA_RPC_GENESIS_MISMATCH');
      expect(fixture.requests.map(({ method }) => method)).toEqual(['getGenesisHash']);
    }
  });

  /**
   * @target createSolanaRpcFeeProducers checks the configured genesis after each of the six callback reads
   * @dependencies each callback shape and a cluster change between its first and final identity reads
   * @scenario invoke every callback while the first genesis matches and the second differs
   * @expected data is read once, a final mismatch refuses its DTO, and no callback retries the operation
   */
  it('checks the configured genesis after each of the six callback reads', async () => {
    const invoke = [
      (f: ReturnType<typeof createFeeProducerFixture>) =>
        f.producers.readBalance({ address: TEST_ADDRESS, ...finalizedRequest() }),
      (f: ReturnType<typeof createFeeProducerFixture>) =>
        f.producers.readLatestBlockhash(finalizedRequest()),
      (f: ReturnType<typeof createFeeProducerFixture>) =>
        f.producers.readFeePayer({ ...finalizedRequest(), address: TEST_ADDRESS }),
      (f: ReturnType<typeof createFeeProducerFixture>) =>
        f.producers.readRentMinimum({
          clusterGenesisHash: EXPECTED_GENESIS_HASH,
          commitment: 'finalized',
          dataLength: 0,
        }),
      (f: ReturnType<typeof createFeeProducerFixture>) =>
        f.producers.readMessageFee({ ...finalizedRequest(), messageBase64: 'AQ==' }),
      (f: ReturnType<typeof createFeeProducerFixture>) =>
        f.producers.readBlockHeight({
          clusterGenesisHash: EXPECTED_GENESIS_HASH,
          commitment: 'confirmed',
          minContextSlot: MIN_CONTEXT_SLOT,
        }),
    ];
    const dataMethods = [
      undefined,
      'getLatestBlockhash',
      'getAccountInfo',
      'getMinimumBalanceForRentExemption',
      'getFeeForMessage',
      'getBlockHeight',
    ] as const;
    for (const [index, read] of invoke.entries()) {
      const fixture = createFeeProducerFixture({
        genesisValues: [EXPECTED_GENESIS_HASH, OTHER_GENESIS_HASH],
      });
      await expectProducerError(() => read(fixture), 'SOLANA_RPC_GENESIS_MISMATCH');
      const methods = fixture.requests.map(({ method }) => method);
      expect(methods).toEqual(
        index === 0
          ? ['getGenesisHash', 'getGenesisHash']
          : ['getGenesisHash', dataMethods[index], 'getGenesisHash'],
      );
      expect(fixture.requests).toHaveLength(index === 0 ? 2 : 3);
    }
  });

  /**
   * @target createSolanaRpcFeeProducers captures producer options and callback request before asynchronous work
   * @dependencies one mutable factory configuration, one mutable request, and a gated local genesis response
   * @scenario mutate the caller objects after producer creation and after the read reaches its first await
   * @expected the original transport/callback references and copied request floor remain in use
   */
  it('captures producer options and callback request before asynchronous work', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstGenesis = true;
    const fixture = createFeeProducerFixture({
      beforeResponse: (request) => {
        if (request.method === 'getGenesisHash' && firstGenesis) {
          firstGenesis = false;
          return firstGate;
        }
      },
    });
    const originalConfiguration = fixture.configuration;
    const secondReadBalance = vi.fn(async () => ({ changed: true }));
    const mutableConfiguration = originalConfiguration as unknown as Record<string, unknown>;
    Object.assign(mutableConfiguration, {
      expectedGenesisHash: OTHER_GENESIS_HASH,
      readBalance: secondReadBalance,
      transport: async () => {
        throw new Error('replacement transport must not run');
      },
    });
    const mutableRequest = {
      clusterGenesisHash: EXPECTED_GENESIS_HASH,
      commitment: 'finalized',
      minContextSlot: MIN_CONTEXT_SLOT,
    } as unknown as { clusterGenesisHash: string; commitment: 'finalized'; minContextSlot: bigint };
    const pending = fixture.producers.readLatestBlockhash(mutableRequest);
    mutableRequest.clusterGenesisHash = OTHER_GENESIS_HASH;
    mutableRequest.minContextSlot = 0n;
    releaseFirst?.();
    const result = (await pending) as { readonly contextSlot: bigint };
    const balanceResult = await fixture.producers.readBalance({
      address: TEST_ADDRESS,
      ...finalizedRequest(),
    });

    expect(result.contextSlot).toEqual(MIN_CONTEXT_SLOT);
    expect(fixture.requests[1].params).toEqual([
      { commitment: 'finalized', minContextSlot: MIN_CONTEXT_SLOT },
    ]);
    expect(balanceResult).toEqual({
      fixture: 'balance',
      address: TEST_ADDRESS,
      floor: MIN_CONTEXT_SLOT,
    });
    expect(secondReadBalance).not.toHaveBeenCalled();
  });

  /**
   * @target createSolanaRpcFeeProducers preserves the original balance and transport error objects
   * @dependencies one callback-owned error and one injected transport error with distinct object identity
   * @scenario reject a balance callback and a contextual RPC request after the initial genesis check
   * @expected the exact original error object is rethrown after the post-read genesis check
   */
  it('preserves the original balance and transport error objects', async () => {
    const callbackError = new Error('local balance callback failure');
    const callbackFixture = createFeeProducerFixture({
      readBalance: async () => {
        throw callbackError;
      },
    });
    let caughtCallback: unknown;
    try {
      await callbackFixture.producers.readBalance({
        address: TEST_ADDRESS,
        ...finalizedRequest(),
      });
    } catch (error) {
      caughtCallback = error;
    }
    expect(caughtCallback).toBe(callbackError);
    expect(callbackFixture.requests.map(({ method }) => method)).toEqual([
      'getGenesisHash',
      'getGenesisHash',
    ]);

    const transportError = new Error('injected local transport failure');
    const transportFixture = createFeeProducerFixture({
      transportError: (request) =>
        request.method === 'getBlockHeight' ? transportError : undefined,
    });
    let caughtTransport: unknown;
    try {
      await transportFixture.producers.readBlockHeight({
        clusterGenesisHash: EXPECTED_GENESIS_HASH,
        commitment: 'confirmed',
        minContextSlot: MIN_CONTEXT_SLOT,
      });
    } catch (error) {
      caughtTransport = error;
    }
    expect(caughtTransport).toBe(transportError);
    expect(transportFixture.requests.map(({ method }) => method)).toEqual([
      'getGenesisHash',
      'getBlockHeight',
      'getGenesisHash',
    ]);
  });

  /**
   * @target createSolanaRpcFeeProducers rejects $name minContextSlot values before RPC
   * @dependencies fractional, exponent-sized, negative, above-u64 and non-bigint minContextSlot values
   * @scenario submit each invalid floor through the confirmed height callback
   * @expected each input is rejected as a producer request before genesis or data transport is invoked
   */
  it.each(invalidFloorCases)(
    'createSolanaRpcFeeProducers rejects $name minContextSlot values before RPC',
    async ({ value }) => {
      const fixture = createFeeProducerFixture();
      await expectProducerError(
        () =>
          fixture.producers.readBlockHeight({
            clusterGenesisHash: EXPECTED_GENESIS_HASH,
            commitment: 'confirmed',
            minContextSlot: value,
          } as unknown as Parameters<SolanaLockFeeProducers['readBlockHeight']>[0]),
        'SOLANA_RPC_PRODUCER_REQUEST_INVALID',
      );
      expect(fixture.requests).toEqual([]);
    },
  );

  /**
   * @target createSolanaRpcFeeProducers rejects request genesis and commitment mismatches before transport
   * @dependencies one mismatched canonical genesis request and one wrong commitment request
   * @scenario pass request metadata that differs from the captured producer contract
   * @expected the request fails before any genesis, callback, or data RPC request occurs
   */
  it('rejects request genesis and commitment mismatches before transport', async () => {
    const genesisFixture = createFeeProducerFixture();
    await expectProducerError(
      () =>
        genesisFixture.producers.readLatestBlockhash({
          clusterGenesisHash: OTHER_GENESIS_HASH,
          commitment: 'finalized',
          minContextSlot: 0n,
        }),
      'SOLANA_RPC_GENESIS_MISMATCH',
    );
    const commitmentFixture = createFeeProducerFixture();
    await expectProducerError(
      () =>
        commitmentFixture.producers.readBlockHeight({
          clusterGenesisHash: EXPECTED_GENESIS_HASH,
          commitment: 'finalized',
          minContextSlot: 0n,
        } as unknown as Parameters<SolanaLockFeeProducers['readBlockHeight']>[0]),
      'SOLANA_RPC_PRODUCER_REQUEST_INVALID',
    );
    expect(genesisFixture.requests).toEqual([]);
    expect(commitmentFixture.requests).toEqual([]);
  });

  /**
   * @target createSolanaRpcFeeProducers rejects a valid response whose context slot is below the request floor
   * @dependencies valid parsed contextual JSON with a slot exactly one below minContextSlot
   * @scenario request a latest blockhash with a larger floor than the returned context slot
   * @expected the provider returns no partial blockhash DTO and reports the context-floor error
   */
  it('rejects a valid response whose context slot is below the request floor', async () => {
    const fixture = createFeeProducerFixture({
      resultOverrides: {
        getLatestBlockhash: contextualResult(
          (MIN_CONTEXT_SLOT - 1n).toString(),
          `{"blockhash":"${TEST_BLOCKHASH}","lastValidBlockHeight":${U64_MAX}}`,
        ),
      },
    });
    await expectProducerError(
      () => fixture.producers.readLatestBlockhash(finalizedRequest()),
      'SOLANA_RPC_CONTEXT_BELOW_FLOOR',
    );
    expect(fixture.requests.map(({ method }) => method)).toEqual([
      'getGenesisHash',
      'getLatestBlockhash',
      'getGenesisHash',
    ]);
  });

  /**
   * @target createSolanaRpcFeeProducers rejects a $name block height lexeme
   * @dependencies malformed fractional, exponent, negative and above-u64 block-height tokens
   * @scenario parse each raw scalar response through the shared duplicate-aware JSON AST reader
   * @expected malformed tokens receive the shared exact invalid-u64 or out-of-range code
   */
  it.each(invalidBlockHeightCases)(
    'createSolanaRpcFeeProducers rejects a $name block height lexeme',
    async ({ lexeme, error }) => {
      const fixture = createFeeProducerFixture({
        resultOverrides: { getBlockHeight: lexeme },
      });
      await expectProducerError(
        () =>
          fixture.producers.readBlockHeight({
            clusterGenesisHash: EXPECTED_GENESIS_HASH,
            commitment: 'confirmed',
            minContextSlot: MIN_CONTEXT_SLOT,
          }),
        error,
      );
      expect(fixture.requests.at(-1)?.method).toEqual('getGenesisHash');
    },
  );

  /**
   * @target createSolanaRpcFeeProducers preserves duplicate JSON key rejection from the shared protocol parser
   * @dependencies one raw block-height response envelope with a duplicated result member
   * @scenario return the duplicate envelope only for getBlockHeight and valid genesis responses otherwise
   * @expected the shared parser rejects the response and the provider does not synthesize a height
   */
  it('preserves duplicate JSON key rejection from the shared protocol parser', async () => {
    const fixture = createFeeProducerFixture({
      responseOverride: (request) =>
        request.method === 'getBlockHeight'
          ? `{"jsonrpc":"2.0","id":${request.id},"result":1,"result":2}`
          : undefined,
    });
    await expectProducerError(
      () =>
        fixture.producers.readBlockHeight({
          clusterGenesisHash: EXPECTED_GENESIS_HASH,
          commitment: 'confirmed',
          minContextSlot: MIN_CONTEXT_SLOT,
        }),
      'SOLANA_RPC_DUPLICATE_JSON_KEY',
    );
    expect(fixture.requests.at(-1)?.method).toEqual('getGenesisHash');
  });

  /**
   * @target createSolanaRpcFeeProducers preserves null and zero message fees as distinct values
   * @dependencies contextual getFeeForMessage results with JSON null and JSON integer zero
   * @scenario read each fee result with the same exact message bytes and context floor
   * @expected null remains null for the quote to refuse and zero becomes 0n
   */
  it('preserves null and zero message fees as distinct values', async () => {
    const messageBase64 = 'AQIDBA==';
    const nullFixture = createFeeProducerFixture({
      resultOverrides: {
        getFeeForMessage: contextualResult(MIN_CONTEXT_SLOT.toString(), 'null'),
      },
    });
    const nullFee = (await nullFixture.producers.readMessageFee({
      ...finalizedRequest(),
      messageBase64,
    })) as { readonly feeLamports: bigint | null; readonly messageBase64: string };
    const zeroFixture = createFeeProducerFixture({
      resultOverrides: {
        getFeeForMessage: contextualResult(MIN_CONTEXT_SLOT.toString(), '0'),
      },
    });
    const zeroFee = (await zeroFixture.producers.readMessageFee({
      ...finalizedRequest(),
      messageBase64,
    })) as { readonly feeLamports: bigint | null; readonly messageBase64: string };

    expect(nullFee.feeLamports).toEqual(null);
    expect(zeroFee.feeLamports).toEqual(0n);
    expect(nullFee.messageBase64).toEqual(messageBase64);
    expect(zeroFee.messageBase64).toEqual(messageBase64);
  });

  /**
   * @target createSolanaRpcFeeProducers preserves the observed fee-payer fields instead of manufacturing eligibility
   * @dependencies an owned, executable account with nonempty canonical base64 data and exact raw u64 fields
   * @scenario decode the complete getAccountInfo account without assuming System Program eligibility
   * @expected owner, executable, data bytes and lamports are projected from the response for the quote to validate
   */
  it('preserves the observed fee-payer fields instead of manufacturing eligibility', async () => {
    const rawAccount = `{"data":["AQID","base64"],"executable":true,"lamports":9007199254740993,"owner":"${OTHER_GENESIS_HASH}","rentEpoch":1,"space":3}`;
    const fixture = createFeeProducerFixture({
      resultOverrides: {
        getAccountInfo: contextualResult(MIN_CONTEXT_SLOT.toString(), rawAccount),
      },
    });
    const payer = (await fixture.producers.readFeePayer({
      ...finalizedRequest(),
      address: TEST_ADDRESS,
    })) as {
      readonly owner: string;
      readonly executable: boolean;
      readonly dataBase64: string;
      readonly lamports: bigint;
    };

    expect(payer.owner).toEqual(OTHER_GENESIS_HASH);
    expect(payer.executable).toEqual(true);
    expect(payer.dataBase64).toEqual('AQID');
    expect(payer.lamports).toEqual(9_007_199_254_740_993n);
  });

  /**
   * @target createSolanaRpcFeeProducers rejects null payer accounts and malformed account data
   * @dependencies a null account result and malformed base64 account bytes in independent replies
   * @scenario parse getAccountInfo account selection and full observed data tuple independently
   * @expected null is unavailable and malformed bytes fail without returning a partial payer DTO
   */
  it('rejects null payer accounts and malformed account data', async () => {
    const nullFixture = createFeeProducerFixture({
      resultOverrides: {
        getAccountInfo: contextualResult(MIN_CONTEXT_SLOT.toString(), 'null'),
      },
    });
    await expectProducerError(
      () =>
        nullFixture.producers.readFeePayer({
          ...finalizedRequest(),
          address: TEST_ADDRESS,
        }),
      'SOLANA_RPC_FEE_PAYER_UNAVAILABLE',
    );
    const malformedFixture = createFeeProducerFixture({
      resultOverrides: {
        getAccountInfo: contextualResult(
          MIN_CONTEXT_SLOT.toString(),
          `{"data":["!","base64"],"executable":false,"lamports":0,"owner":"${TEST_ADDRESS}","rentEpoch":0}`,
        ),
      },
    });
    await expectProducerError(
      () =>
        malformedFixture.producers.readFeePayer({
          ...finalizedRequest(),
          address: TEST_ADDRESS,
        }),
      'SOLANA_RPC_FEE_PAYER_INVALID',
    );
  });

  /**
   * @target createSolanaRpcFeeProducers accepts the message byte limit and rejects one byte over before RPC
   * @dependencies one canonical message encoding exactly 1232 bytes and one encoding one byte larger
   * @scenario decode message base64 only after rejecting an over-bound request string
   * @expected 1232 bytes are accepted unchanged and 1233 bytes fail before any RPC call
   */
  it('accepts the message byte limit and rejects one byte over before RPC', async () => {
    const exactMessage = Buffer.alloc(1232, 7).toString('base64');
    const exactFixture = createFeeProducerFixture();
    const fee = (await exactFixture.producers.readMessageFee({
      ...finalizedRequest(),
      messageBase64: exactMessage,
    })) as { readonly messageBase64: string };
    expect(fee.messageBase64).toEqual(exactMessage);
    const oversizedFixture = createFeeProducerFixture();
    const oversizedMessage = Buffer.alloc(1233, 7).toString('base64');
    await expectProducerError(
      () =>
        oversizedFixture.producers.readMessageFee({
          ...finalizedRequest(),
          messageBase64: oversizedMessage,
        }),
      'SOLANA_RPC_MESSAGE_INVALID',
    );
    expect(oversizedFixture.requests).toEqual([]);
  });
});
