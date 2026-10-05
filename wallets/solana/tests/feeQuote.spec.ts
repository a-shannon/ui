import { Buffer } from 'buffer';

import { describe, expect, it, vi } from 'vitest';

import { SOLANA_U64_MAX } from '@rosen-network/solana';

import {
  isCurrentSolanaWalletSession,
  type SolanaWalletSession,
} from '../src/eventBoundWalletPort';
import {
  getSolanaLockFeeQuoteBuild,
  isCurrentSolanaLockFeeQuote,
  prepareSolanaLockFeeQuote,
  revalidateSolanaLockFeeQuote,
  type SolanaLockFeeIntent,
  type SolanaLockFeeOptions,
  type SolanaLockFeeProducers,
} from '../src/feeQuote';
import {
  createFeeQuoteFixture,
  feeQuoteArguments,
  feeQuoteDescriptorTrap,
} from './feeQuoteTestUtils';
import { invalidateFeeQuoteSession, mockIsCurrentFeeQuoteSession } from './mocked/feeQuote.mock';
import { deferredReadPortResult } from './readPortTestUtils';
import { captureTestProfile, keypair } from './testUtils';

vi.mock('../src/eventBoundWalletPort', async () => {
  const mocked = await import('./mocked/feeQuote.mock');
  return { isCurrentSolanaWalletSession: vi.fn(mocked.mockIsCurrentFeeQuoteSession) };
});

describe('prepareSolanaLockFeeQuote', () => {
  /**
   * @target prepareSolanaLockFeeQuote binds the exact message and conservatively budgets native SOL
   * @dependencies fully mocked service producers and session connector; captured fixture profile and builder
   * @scenario SOL gross1000, view2000, payer1900, fee7 and reserve max5/11
   * @expected available1900, reserve11 and maximum1882; Rosen fees remain inside gross
   */
  it('binds the exact message and conservatively budgets native SOL', async () => {
    const f = createFeeQuoteFixture();
    const quote = await prepareSolanaLockFeeQuote(...feeQuoteArguments(f));
    expect(quote.nativeAvailable).toEqual(1900n);
    expect(quote.nativeReserve).toEqual(11n);
    expect(quote.indicativeMaximumGrossAmount).toEqual(1882n);
    expect(quote.sourceQuantum).toEqual(1n);
    expect(quote.contextSlot).toEqual(13n);
    const build = getSolanaLockFeeQuoteBuild(quote);
    expect(quote.messageBase64).toEqual(
      Buffer.from(build.transaction.serializeMessage()).toString('base64'),
    );
    expect(JSON.parse(build.memo)).toMatchObject({
      amount: '1000',
      networkFee: '100',
      bridgeFee: '200',
    });
    expect(f.producers.readBalance.mock.calls[0][0].minContextSlot).toEqual(0n);
    expect(f.producers.readLatestBlockhash.mock.calls[0][0].minContextSlot).toEqual(10n);
    expect(f.producers.readFeePayer.mock.calls[0][0].minContextSlot).toEqual(11n);
    expect(f.producers.readMessageFee.mock.calls[0][0].minContextSlot).toEqual(12n);
    expect(f.producers.readBlockHeight.mock.calls[0][0]).toEqual({
      clusterGenesisHash: f.profile.clusterGenesisHash,
      commitment: 'confirmed',
      minContextSlot: 13n,
    });
    expect(f.producers.readRentMinimum.mock.calls[0][0]).toEqual({
      clusterGenesisHash: f.profile.clusterGenesisHash,
      commitment: 'finalized',
      dataLength: 0,
    });
    expect(Object.isFrozen(quote)).toEqual(true);
  });

  /**
   * @target prepareSolanaLockFeeQuote accepts an actual zero fee and explicit reserve dominance
   * @dependencies fully mocked service producers and session connector
   * @scenario fee0, explicit reserve20 exceeding rent11, native view smaller than payer
   * @expected exact zero preserved and minimum available/maximum reserve used
   */
  it('accepts an actual zero fee and explicit reserve dominance', async () => {
    const f = createFeeQuoteFixture();
    f.fee.feeLamports = 0n;
    f.options.minimumNativeRemainder = 20n;
    f.balance.nativeBalance = 1100n;
    const quote = await prepareSolanaLockFeeQuote(...feeQuoteArguments(f));
    expect(quote.feeLamports).toEqual(0n);
    expect(quote.nativeReserve).toEqual(20n);
    expect(quote.indicativeMaximumGrossAmount).toEqual(1080n);
  });

  /**
   * @target prepareSolanaLockFeeQuote refuses invalid message fee %s
   * @dependencies fully mocked service producers and session connector
   * @scenario independently null, number, string, negative or overflow fee with exact echoed message
   * @expected precise unavailable/type/range refusal
   */
  it.each([
    ['null', null, 'Message fee is unavailable'],
    ['number', 7, 'Invalid raw message fee'],
    ['string', '7', 'Invalid raw message fee'],
    ['negative', -1n, 'Invalid raw message fee range'],
    ['overflow', SOLANA_U64_MAX + 1n, 'Invalid raw message fee range'],
  ])('refuses invalid message fee %s', async (_label, value, error) => {
    const f = createFeeQuoteFixture();
    f.producers.readMessageFee.mockImplementation(async (request) => ({
      ...f.fee,
      messageBase64: request.messageBase64,
      feeLamports: value,
    }));
    await expect(prepareSolanaLockFeeQuote(...feeQuoteArguments(f))).rejects.toThrow(
      error as string,
    );
  });

  /**
   * @target prepareSolanaLockFeeQuote rejects isolated payer field %s
   * @dependencies fully mocked service producers and session connector
   * @scenario valid canonical unrelated address/owner, executable, data or non-bigint lamports
   * @expected precise payer policy refusal without a masked canonical-key failure
   */
  it.each([
    ['address', keypair(2).publicKey.toBase58(), 'Fee payer address differs from wallet session'],
    ['owner', keypair(2).publicKey.toBase58(), 'Fee payer must be owned by System Program'],
    ['executable', true, 'Fee payer must not be executable'],
    ['dataBase64', 'AA==', 'Fee payer data must be empty'],
    ['lamports', 1900, 'Invalid raw fee payer lamports'],
  ])('rejects isolated payer field %s', async (field, value, error) => {
    const f = createFeeQuoteFixture();
    f.producers.readFeePayer.mockResolvedValue({ ...f.payer, [field as string]: value });
    await expect(prepareSolanaLockFeeQuote(...feeQuoteArguments(f))).rejects.toThrow(
      error as string,
    );
  });

  /**
   * @target prepareSolanaLockFeeQuote rejects response binding failure %s
   * @dependencies fully mocked service producers and session connector
   * @scenario independently wrong genesis, commitment, message echo or scalar rent data length
   * @expected exact response-specific binding error
   */
  it.each([
    'hash genesis',
    'payer genesis',
    'rent genesis',
    'fee genesis',
    'height genesis',
    'hash finality',
    'payer finality',
    'rent finality',
    'fee finality',
    'height finality',
    'message echo',
    'rent length',
  ] as const)('rejects response binding failure %s', async (scenario) => {
    const f = createFeeQuoteFixture();
    const genesis = keypair(8).publicKey.toBase58();
    let error = '';
    if (scenario === 'hash genesis') {
      f.blockhash.clusterGenesisHash = genesis;
      error = 'blockhash genesis differs';
    }
    if (scenario === 'payer genesis') {
      f.payer.clusterGenesisHash = genesis;
      error = 'fee payer genesis differs';
    }
    if (scenario === 'rent genesis') {
      f.rent.clusterGenesisHash = genesis;
      error = 'rent minimum genesis differs';
    }
    if (scenario === 'fee genesis') {
      f.fee.clusterGenesisHash = genesis;
      error = 'message fee genesis differs';
    }
    if (scenario === 'height genesis') {
      f.height.clusterGenesisHash = genesis;
      error = 'block height genesis differs';
    }
    if (scenario === 'hash finality') {
      f.producers.readLatestBlockhash.mockResolvedValue({
        ...f.blockhash,
        commitment: 'confirmed',
      });
      error = 'Invalid blockhash commitment';
    }
    if (scenario === 'payer finality') {
      f.producers.readFeePayer.mockResolvedValue({ ...f.payer, commitment: 'confirmed' });
      error = 'Invalid fee payer commitment';
    }
    if (scenario === 'rent finality') {
      f.producers.readRentMinimum.mockResolvedValue({ ...f.rent, commitment: 'confirmed' });
      error = 'Invalid rent minimum commitment';
    }
    if (scenario === 'fee finality') {
      f.producers.readMessageFee.mockImplementation(async (r) => ({
        ...f.fee,
        messageBase64: r.messageBase64,
        commitment: 'confirmed',
      }));
      error = 'Invalid message fee commitment';
    }
    if (scenario === 'height finality') {
      f.producers.readBlockHeight.mockResolvedValue({ ...f.height, commitment: 'finalized' });
      error = 'Invalid block height commitment';
    }
    if (scenario === 'message echo') {
      f.producers.readMessageFee.mockResolvedValue({ ...f.fee, messageBase64: 'AA==' });
      error = 'Message fee differs from captured message';
    }
    if (scenario === 'rent length') {
      f.rent.dataLength = 1;
      error = 'Rent minimum must describe zero data';
    }
    await expect(prepareSolanaLockFeeQuote(...feeQuoteArguments(f))).rejects.toThrow(error);
  });

  /**
   * @target prepareSolanaLockFeeQuote rejects a regressing context at %s
   * @dependencies fully mocked service producers and session connector
   * @scenario each contextual response is one slot below its actual requested floor
   * @expected exact source-specific context-floor refusal
   */
  it.each(['blockhash', 'fee payer', 'message fee'] as const)(
    'rejects a regressing context at %s',
    async (stage) => {
      const f = createFeeQuoteFixture();
      if (stage === 'blockhash') f.blockhash.contextSlot = 9n;
      if (stage === 'fee payer') f.payer.contextSlot = 10n;
      if (stage === 'message fee') f.fee.contextSlot = 11n;
      await expect(prepareSolanaLockFeeQuote(...feeQuoteArguments(f))).rejects.toThrow(
        `${stage} context is below requested floor`,
      );
    },
  );

  /**
   * @target prepareSolanaLockFeeQuote enforces expiration policy %s
   * @dependencies fully mocked service producers and session connector
   * @scenario height above last-valid, equality with zero margin, equality with one margin, exact one-block margin
   * @expected expiry uses greater-than; explicit remaining-block policy is independent
   */
  it.each([
    ['expired', 201n, 0n, 'Solana quote blockhash expired'],
    ['equal zero', 200n, 0n, null],
    ['equal one', 200n, 1n, 'Solana quote has insufficient remaining blocks'],
    ['one remaining', 199n, 1n, null],
  ])('enforces expiration policy %s', async (_label, height, margin, error) => {
    const f = createFeeQuoteFixture();
    f.height.blockHeight = height as bigint;
    f.options.minimumRemainingBlocks = margin as bigint;
    const pending = prepareSolanaLockFeeQuote(...feeQuoteArguments(f));
    if (error) await expect(pending).rejects.toThrow(error as string);
    else expect((await pending).blockHeight).toEqual(height);
  });

  /**
   * @target prepareSolanaLockFeeQuote refuses insufficient budget %s
   * @dependencies fully mocked service producers and session connector
   * @scenario independently native gross shortage, fee/reserve shortage, and one SPL account shortage despite aggregate funds
   * @expected exact shortage; no aggregation or duplicate Rosen-fee deduction
   */
  it.each(['native gross', 'native overhead', 'selected SPL', 'SPL native overhead'] as const)(
    'refuses insufficient budget %s',
    async (scenario) => {
      const f = createFeeQuoteFixture(scenario.startsWith('native') ? 'native' : 'spl');
      let error = 'Insufficient native fee and reserve balance';
      if (scenario === 'native gross') {
        f.payer.lamports = 1017n;
        error = 'Insufficient native gross balance';
      }
      if (scenario.endsWith('overhead')) f.payer.lamports = 17n;
      if (scenario === 'selected SPL') {
        f.balance.tokenAccounts = [
          { ...f.balance.tokenAccounts[0], amount: 999n },
          {
            ...f.balance.tokenAccounts[0],
            address: keypair(10).publicKey.toBase58(),
            amount: 100000n,
          },
        ];
        error = 'Insufficient selected SPL account balance';
      }
      await expect(prepareSolanaLockFeeQuote(...feeQuoteArguments(f))).rejects.toThrow(error);
    },
  );

  /**
   * @target prepareSolanaLockFeeQuote rounds the source budget down to exact destination quantum
   * @dependencies fully mocked service producers and session connector; captured native decimal policy
   * @scenario source decimals9, destination6, gross10000 and raw native budget20899
   * @expected source quantum1000 and maximum20000 without floating-point conversion
   */
  it('rounds the source budget down to exact destination quantum', async () => {
    const f = createFeeQuoteFixture();
    const profile = captureTestProfile({
      SOL: {
        ...f.profile.assets.SOL,
        destinationDecimals: 6,
        minimumGrossAmount: '10000',
        networkFee: '1000',
        bridgeFee: '2000',
      },
    });
    f.balance.nativeBalance = 30000n;
    f.payer.lamports = 20917n;
    const quote = await prepareSolanaLockFeeQuote(
      profile,
      f.session,
      { ...f.intent, grossAmount: '10000' },
      f.producers,
      f.options,
    );
    expect(quote.sourceQuantum).toEqual(1000n);
    expect(quote.indicativeMaximumGrossAmount).toEqual(20000n);
  });

  /**
   * @target prepareSolanaLockFeeQuote clamps the maximum to captured policy and exact Ergo conversion
   * @dependencies fully mocked service producers and session connector; captured SPL decimal policy
   * @scenario source decimals0 and destination18 with gross1, zero Rosen fees and policy maximum9
   * @expected maximum9 is exactly representable within the Ergo signed range
   */
  it('clamps the maximum to captured policy and exact Ergo conversion', async () => {
    const f = createFeeQuoteFixture('spl');
    const mint = f.intent.asset;
    const profile = captureTestProfile({
      [mint]: {
        ...f.profile.assets[mint],
        sourceDecimals: 0,
        destinationDecimals: 18,
        minimumGrossAmount: '1',
        maximumGrossAmount: '9',
        networkFee: '0',
        bridgeFee: '0',
      },
    });
    f.balance.tokenAccounts = [{ ...f.balance.tokenAccounts[0], decimals: 0 }];
    const quote = await prepareSolanaLockFeeQuote(
      profile,
      f.session,
      { ...f.intent, grossAmount: '1' },
      f.producers,
      f.options,
    );
    expect(quote.indicativeMaximumGrossAmount).toEqual(9n);
    expect(quote.sourceQuantum).toEqual(1n);
  });

  /**
   * @target prepareSolanaLockFeeQuote enforces a policy ceiling below the independent Ergo signed ceiling
   * @dependencies fully mocked service producers and session connector; captured SPL decimal policy
   * @scenario source decimals0, destination18, sufficient funds and policy maximum8 below Ergo ceiling9
   * @expected maximum8 isolates the policy clamp from signed representability
   */
  it('enforces a policy ceiling below the independent Ergo signed ceiling', async () => {
    const f = createFeeQuoteFixture('spl');
    const mint = f.intent.asset;
    const profile = captureTestProfile({
      [mint]: {
        ...f.profile.assets[mint],
        sourceDecimals: 0,
        destinationDecimals: 18,
        minimumGrossAmount: '1',
        maximumGrossAmount: '8',
        networkFee: '0',
        bridgeFee: '0',
      },
    });
    f.balance.tokenAccounts = [{ ...f.balance.tokenAccounts[0], decimals: 0 }];
    const quote = await prepareSolanaLockFeeQuote(
      profile,
      f.session,
      { ...f.intent, grossAmount: '1' },
      f.producers,
      f.options,
    );
    expect(quote.indicativeMaximumGrossAmount).toEqual(8n);
  });

  /**
   * @target prepareSolanaLockFeeQuote captures option %s before its first await
   * @dependencies fully mocked service producers and session connector; deferred balance service
   * @scenario independently change explicit native reserve or remaining-block margin while balance is pending
   * @expected original reserve20 or original one-block margin remains effective
   */
  it.each(['minimumNativeRemainder', 'minimumRemainingBlocks'] as const)(
    'captures option %s before its first await',
    async (field) => {
      const f = createFeeQuoteFixture();
      if (field === 'minimumNativeRemainder') f.options.minimumNativeRemainder = 20n;
      if (field === 'minimumRemainingBlocks') f.height.blockHeight = 199n;
      const deferred = deferredReadPortResult();
      f.producers.readBalance.mockReturnValue(deferred.promise);
      const pending = prepareSolanaLockFeeQuote(...feeQuoteArguments(f));
      f.options[field] = field === 'minimumNativeRemainder' ? 5000n : 2n;
      deferred.resolve(f.balance);
      const quote = await pending;
      if (field === 'minimumNativeRemainder') expect(quote.nativeReserve).toEqual(20n);
      if (field === 'minimumRemainingBlocks') expect(quote.blockHeight).toEqual(199n);
    },
  );

  /**
   * @target prepareSolanaLockFeeQuote rejects a Number native reserve despite a larger valid rent minimum
   * @dependencies fully mocked service producers and session connector
   * @scenario minimumNativeRemainder is Number5 while rent11 and remaining-block policy are valid
   * @expected exact raw reserve error before any balance producer invocation
   */
  it('rejects a Number native reserve despite a larger valid rent minimum', async () => {
    const f = createFeeQuoteFixture();
    const options = { ...f.options, minimumNativeRemainder: 5 } as unknown as SolanaLockFeeOptions;
    await expect(
      prepareSolanaLockFeeQuote(f.profile, f.session, f.intent, f.producers, options),
    ).rejects.toThrow('Invalid raw minimum native remainder');
    expect(f.producers.readBalance).not.toHaveBeenCalled();
  });

  /**
   * @target prepareSolanaLockFeeQuote rejects non-bigint or out-of-range raw coordinate %s
   * @dependencies fully mocked service producers and session connector
   * @scenario one otherwise valid response coordinate is a number, negative bigint or u64 overflow
   * @expected exact field-specific raw integer error
   */
  it.each([
    ['hash slot number', 'hash', 'contextSlot', 11, 'blockhash context slot'],
    ['hash height negative', 'hash', 'lastValidBlockHeight', -1n, 'last valid block height'],
    [
      'hash height overflow',
      'hash',
      'lastValidBlockHeight',
      SOLANA_U64_MAX + 1n,
      'last valid block height',
    ],
    ['payer slot number', 'payer', 'contextSlot', 12, 'fee payer context slot'],
    ['payer lamports negative', 'payer', 'lamports', -1n, 'fee payer lamports'],
    ['payer lamports overflow', 'payer', 'lamports', SOLANA_U64_MAX + 1n, 'fee payer lamports'],
    ['rent number', 'rent', 'minimumLamports', 11, 'rent minimum'],
    ['rent negative', 'rent', 'minimumLamports', -1n, 'rent minimum'],
    ['rent overflow', 'rent', 'minimumLamports', SOLANA_U64_MAX + 1n, 'rent minimum'],
    ['fee slot number', 'fee', 'contextSlot', 13, 'message fee context slot'],
    ['height number', 'height', 'blockHeight', 190, 'block height'],
    ['height negative', 'height', 'blockHeight', -1n, 'block height'],
    ['height overflow', 'height', 'blockHeight', SOLANA_U64_MAX + 1n, 'block height'],
  ])(
    'rejects non-bigint or out-of-range raw coordinate %s',
    async (_label, target, field, value, error) => {
      const f = createFeeQuoteFixture();
      if (target === 'hash')
        f.producers.readLatestBlockhash.mockResolvedValue({
          ...f.blockhash,
          [field as string]: value,
        });
      if (target === 'payer')
        f.producers.readFeePayer.mockResolvedValue({ ...f.payer, [field as string]: value });
      if (target === 'rent')
        f.producers.readRentMinimum.mockResolvedValue({ ...f.rent, [field as string]: value });
      if (target === 'fee')
        f.producers.readMessageFee.mockImplementation(async (request) => ({
          ...f.fee,
          messageBase64: request.messageBase64,
          [field as string]: value,
        }));
      if (target === 'height')
        f.producers.readBlockHeight.mockResolvedValue({ ...f.height, [field as string]: value });
      await expect(prepareSolanaLockFeeQuote(...feeQuoteArguments(f))).rejects.toThrow(
        `Invalid raw ${error}`,
      );
    },
  );

  /**
   * @target prepareSolanaLockFeeQuote accepts maximum raw heights and slots without converting to number
   * @dependencies fully mocked service producers and session connector
   * @scenario all contextual slots and heights are u64 maximum, with explicit zero remaining margin
   * @expected exact bigint boundaries retained; blockheight equality remains valid
   */
  it('accepts maximum raw heights and slots without converting to number', async () => {
    const f = createFeeQuoteFixture();
    f.balance.nativeContextSlot = SOLANA_U64_MAX;
    f.balance.tokenContextSlot = SOLANA_U64_MAX;
    f.blockhash.contextSlot = SOLANA_U64_MAX;
    f.blockhash.lastValidBlockHeight = SOLANA_U64_MAX;
    f.payer.contextSlot = SOLANA_U64_MAX;
    f.fee.contextSlot = SOLANA_U64_MAX;
    f.height.blockHeight = SOLANA_U64_MAX;
    f.options.minimumRemainingBlocks = 0n;
    const quote = await prepareSolanaLockFeeQuote(...feeQuoteArguments(f));
    expect(quote.contextSlot).toEqual(SOLANA_U64_MAX);
    expect(quote.blockHeight).toEqual(SOLANA_U64_MAX);
  });

  /**
   * @target prepareSolanaLockFeeQuote rejects source selection failure %s
   * @dependencies fully mocked service producers and session connector; actual single-account selector
   * @scenario explicitly named source is frozen, has wrong decimals, wrong mint or is absent
   * @expected exact source-specific refusal even though amounts and native overhead suffice
   */
  it.each(['frozen', 'decimals', 'mint', 'missing'] as const)(
    'rejects source selection failure %s',
    async (scenario) => {
      const f = createFeeQuoteFixture('spl');
      const account = { ...f.balance.tokenAccounts[0] };
      let error = 'Selected source account does not match SPL mint';
      if (scenario === 'frozen') {
        account.state = 'frozen';
        error = 'Selected source account is frozen';
      }
      if (scenario === 'decimals') {
        account.decimals = 5;
        error = 'Selected source account decimals differ from captured policy';
      }
      if (scenario === 'mint') account.mint = keypair(8).publicKey.toBase58();
      f.balance.tokenAccounts = scenario === 'missing' ? [] : [account];
      await expect(prepareSolanaLockFeeQuote(...feeQuoteArguments(f))).rejects.toThrow(error);
    },
  );

  /**
   * @target prepareSolanaLockFeeQuote captures intent and producer callbacks before its first await
   * @dependencies fully mocked service producers and session connector; deferred balance service
   * @scenario caller changes amount and fee callback while balance is pending
   * @expected original gross and callback remain bound to the resulting message
   */
  it('captures intent and producer callbacks before its first await', async () => {
    const f = createFeeQuoteFixture();
    const intent = { ...f.intent };
    const deferred = deferredReadPortResult();
    f.producers.readBalance.mockReturnValue(deferred.promise);
    const pending = prepareSolanaLockFeeQuote(f.profile, f.session, intent, f.producers, f.options);
    intent.grossAmount = '1500';
    f.producers.readMessageFee = vi.fn(async () => {
      throw new Error('replacement callback');
    });
    deferred.resolve(f.balance);
    const quote = await pending;
    expect(getSolanaLockFeeQuoteBuild(quote).grossAmount).toEqual('1000');
    expect(quote.feeLamports).toEqual(7n);
  });

  /**
   * @target prepareSolanaLockFeeQuote refuses hostile record shape %s
   * @dependencies fully mocked service producers and session connector
   * @scenario fee result has accessor, inherited prototype, symbol or extra field
   * @expected descriptor-only rejection without invoking a getter
   */
  it.each(['accessor', 'prototype', 'symbol', 'extra'] as const)(
    'refuses hostile record shape %s',
    async (shape) => {
      const f = createFeeQuoteFixture();
      const getter = vi.fn(() => 7n);
      f.producers.readMessageFee.mockImplementation(async (request) => {
        const result = { ...f.fee, messageBase64: request.messageBase64 };
        if (shape === 'accessor') Object.defineProperty(result, 'feeLamports', { get: getter });
        if (shape === 'prototype') Object.setPrototypeOf(result, { inherited: 1 });
        if (shape === 'symbol') Object.defineProperty(result, Symbol('extra'), { value: 1 });
        if (shape === 'extra') Object.defineProperty(result, 'extra', { value: 1 });
        return result;
      });
      await expect(prepareSolanaLockFeeQuote(...feeQuoteArguments(f))).rejects.toThrow(
        shape === 'accessor'
          ? 'Invalid message fee accessor'
          : shape === 'prototype'
            ? 'Invalid message fee prototype'
            : 'Unexpected or missing message fee fields',
      );
      expect(getter).not.toHaveBeenCalled();
    },
  );

  /**
   * @target prepareSolanaLockFeeQuote rejects invalid captured input %s before producer reads
   * @dependencies fully mocked service producers and session connector
   * @scenario accessor intent, nonfunction callback, number option, extra options or unbranded profile
   * @expected precise input error and no balance call
   */
  it.each([
    'intent accessor',
    'producer function',
    'option bigint',
    'options fields',
    'profile provenance',
  ] as const)('rejects invalid captured input %s before producer reads', async (scenario) => {
    const f = createFeeQuoteFixture();
    let intent: SolanaLockFeeIntent = f.intent;
    let producers: SolanaLockFeeProducers = f.producers;
    let options: SolanaLockFeeOptions = f.options;
    let profile = f.profile;
    let error = '';
    if (scenario === 'intent accessor') {
      intent = { ...f.intent };
      Object.defineProperty(intent, 'grossAmount', { get: () => '1000' });
      error = 'Invalid fee intent accessor';
    }
    if (scenario === 'producer function') {
      producers = {
        ...f.producers,
        readMessageFee: undefined,
      } as unknown as SolanaLockFeeProducers;
      error = 'Invalid fee producer readMessageFee';
    }
    if (scenario === 'option bigint') {
      options = { ...f.options, minimumRemainingBlocks: 1 } as unknown as SolanaLockFeeOptions;
      error = 'Invalid raw minimum remaining blocks';
    }
    if (scenario === 'options fields') {
      options = { ...f.options, extra: 1 } as SolanaLockFeeOptions;
      error = 'Unexpected or missing fee options fields';
    }
    if (scenario === 'profile provenance') {
      profile = { ...f.profile };
      error = 'Solana lock profile was not captured';
    }
    await expect(
      prepareSolanaLockFeeQuote(profile, f.session, intent, producers, options),
    ).rejects.toThrow(error);
    expect(f.producers.readBalance).not.toHaveBeenCalled();
  });

  /**
   * @target prepareSolanaLockFeeQuote rejects session change during descriptor capture
   * @dependencies fully mocked service producers and session connector; descriptor-only proxy trap
   * @scenario rent reply ownKeys invalidates session after the producer await
   * @expected stale refusal after descriptor capture and no fee call
   */
  it('rejects session change during descriptor capture', async () => {
    const f = createFeeQuoteFixture();
    f.producers.readRentMinimum.mockResolvedValue(
      feeQuoteDescriptorTrap(f.rent, () => invalidateFeeQuoteSession(f.session)),
    );
    await expect(prepareSolanaLockFeeQuote(...feeQuoteArguments(f))).rejects.toThrow(
      'Solana wallet session is stale',
    );
    expect(f.producers.readMessageFee).not.toHaveBeenCalled();
  });
});

describe('isCurrentSolanaLockFeeQuote', () => {
  /**
   * @target isCurrentSolanaLockFeeQuote never serializes a returned build copy while checking private evidence
   * @dependencies fully mocked service producers and session connector; returned-copy method spy
   * @scenario caller installs a serializer on its copy that would start revalidation if invoked
   * @expected checker and successor revalidation never invoke the copy serializer
   */
  it('never serializes a returned build copy while checking private evidence', async () => {
    const f = createFeeQuoteFixture();
    const quote = await prepareSolanaLockFeeQuote(...feeQuoteArguments(f));
    const transaction = getSolanaLockFeeQuoteBuild(quote).transaction;
    const serialize = transaction.serializeMessage.bind(transaction);
    f.advance();
    const spy = vi.spyOn(transaction, 'serializeMessage').mockImplementationOnce(() => {
      void revalidateSolanaLockFeeQuote(quote);
      return serialize();
    });
    try {
      expect(isCurrentSolanaLockFeeQuote(quote)).toEqual(true);
      const successor = await revalidateSolanaLockFeeQuote(quote);
      expect(isCurrentSolanaLockFeeQuote(successor)).toEqual(true);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  /**
   * @target isCurrentSolanaLockFeeQuote refuses retirement during its session check
   * @dependencies fully mocked service producers and session connector with one reentrant check
   * @scenario session checking starts a successor revalidation and retires the checked quote
   * @expected old quote cannot report current after that external boundary
   */
  it('refuses retirement during its session check', async () => {
    const f = createFeeQuoteFixture();
    const quote = await prepareSolanaLockFeeQuote(...feeQuoteArguments(f));
    f.advance();
    let successor: ReturnType<typeof revalidateSolanaLockFeeQuote> | undefined;
    vi.mocked(isCurrentSolanaWalletSession).mockImplementationOnce(
      (value: unknown): value is SolanaWalletSession => {
        successor = revalidateSolanaLockFeeQuote(quote);
        return mockIsCurrentFeeQuoteSession(value);
      },
    );
    expect(isCurrentSolanaLockFeeQuote(quote)).toEqual(false);
    expect(isCurrentSolanaLockFeeQuote(await successor)).toEqual(true);
  });

  /**
   * @target isCurrentSolanaLockFeeQuote refuses copied quotes and isolates returned-build mutation without live reads
   * @dependencies fully mocked service producers and session connector
   * @scenario original quote, copied DTO, then mutated transaction blockhash
   * @expected copied quote is unbranded; altered build copy cannot change private evidence or subsequent copies
   */
  it('refuses copied quotes and isolates returned-build mutation without live reads', async () => {
    const f = createFeeQuoteFixture();
    const quote = await prepareSolanaLockFeeQuote(...feeQuoteArguments(f));
    expect(isCurrentSolanaLockFeeQuote(quote)).toEqual(true);
    expect(isCurrentSolanaLockFeeQuote({ ...quote })).toEqual(false);
    const build = getSolanaLockFeeQuoteBuild(quote);
    build.transaction.recentBlockhash = keypair(12).publicKey.toBase58();
    expect(isCurrentSolanaLockFeeQuote(quote)).toEqual(true);
    const fresh = getSolanaLockFeeQuoteBuild(quote);
    expect(fresh).not.toBe(build);
    expect(Buffer.from(fresh.transaction.serializeMessage()).toString('base64')).toEqual(
      quote.messageBase64,
    );
    expect(f.producers.readBlockHeight).toHaveBeenCalledTimes(1);
  });
});

describe('revalidateSolanaLockFeeQuote', () => {
  /**
   * @target revalidateSolanaLockFeeQuote propagates the identical balance error and keeps its predecessor retired
   * @dependencies fully mocked service producers and session connector; deferred balance service
   * @scenario balance service rejects after revalidation has synchronously retired the old quote
   * @expected same Error object propagates and old quote stays inactive before and after rejection
   */
  it('propagates the identical balance error and keeps its predecessor retired', async () => {
    const f = createFeeQuoteFixture();
    const quote = await prepareSolanaLockFeeQuote(...feeQuoteArguments(f));
    const deferred = deferredReadPortResult();
    f.producers.readBalance.mockReturnValue(deferred.promise);
    const error = new Error('synthetic balance unavailable');
    const pending = revalidateSolanaLockFeeQuote(quote);
    expect(isCurrentSolanaLockFeeQuote(quote)).toEqual(false);
    const rejected = expect(pending).rejects.toBe(error);
    deferred.reject(error);
    await rejected;
    expect(isCurrentSolanaLockFeeQuote(quote)).toEqual(false);
    expect(f.producers.readMessageFee).toHaveBeenCalledTimes(1);
  });

  /**
   * @target revalidateSolanaLockFeeQuote retires its predecessor and returns a fresh quote for the same message
   * @dependencies fully mocked service producers and session connector
   * @scenario advance all contexts and change the fee before revalidation
   * @expected old quote retired, independent returned build has identical bytes, no second blockhash request
   */
  it('retires its predecessor and returns a fresh quote for the same message', async () => {
    const f = createFeeQuoteFixture();
    const old = await prepareSolanaLockFeeQuote(...feeQuoteArguments(f));
    const build = getSolanaLockFeeQuoteBuild(old);
    f.advance();
    f.fee.feeLamports = 8n;
    const pending = revalidateSolanaLockFeeQuote(old);
    expect(isCurrentSolanaLockFeeQuote(old)).toEqual(false);
    const quote = await pending;
    const fresh = getSolanaLockFeeQuoteBuild(quote);
    expect(fresh).not.toBe(build);
    expect(Buffer.from(fresh.transaction.serializeMessage()).toString('base64')).toEqual(
      old.messageBase64,
    );
    expect(quote.messageBase64).toEqual(old.messageBase64);
    expect(quote.feeLamports).toEqual(8n);
    expect(quote.contextSlot).toEqual(22n);
    expect(f.producers.readBalance.mock.calls[1][0].minContextSlot).toEqual(13n);
    expect(f.producers.readLatestBlockhash).toHaveBeenCalledTimes(1);
    await expect(revalidateSolanaLockFeeQuote(old)).rejects.toThrow(
      'Solana fee quote is stale or not captured',
    );
  });

  /**
   * @target revalidateSolanaLockFeeQuote keeps the predecessor retired after failure %s
   * @dependencies fully mocked service producers and session connector
   * @scenario independently context regression, fee failure, expired original blockhash or reduced balance
   * @expected precise failure and no locally current predecessor
   */
  it.each(['balance floor', 'null fee', 'expired height', 'reduced balance'] as const)(
    'keeps the predecessor retired after failure %s',
    async (scenario) => {
      const f = createFeeQuoteFixture();
      const quote = await prepareSolanaLockFeeQuote(...feeQuoteArguments(f));
      f.advance();
      let error = '';
      if (scenario === 'balance floor') {
        f.balance.nativeContextSlot = 12n;
        f.balance.tokenContextSlot = 12n;
        error = 'balance context is below requested floor';
      }
      if (scenario === 'null fee') {
        f.fee.feeLamports = null;
        error = 'Message fee is unavailable';
      }
      if (scenario === 'expired height') {
        f.height.blockHeight = 201n;
        error = 'Solana quote blockhash expired';
      }
      if (scenario === 'reduced balance') {
        f.balance.nativeBalance = 1017n;
        error = 'Insufficient native gross balance';
      }
      await expect(revalidateSolanaLockFeeQuote(quote)).rejects.toThrow(error);
      expect(isCurrentSolanaLockFeeQuote(quote)).toEqual(false);
    },
  );
});
