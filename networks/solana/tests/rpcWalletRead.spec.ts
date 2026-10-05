import { describe, expect, it } from 'vitest';

import {
  createSolanaRpcWalletReadProducer,
  SOLANA_SPL_PROGRAM_ID,
  type SolanaWalletReadResult,
} from '@rosen-network/solana';

import {
  WALLET_READ_BATCH_FALSIFIER_COUNT,
  WALLET_READ_FLOOR,
  WALLET_READ_MAX_ACCOUNTS,
  WALLET_READ_MINT_BATCH_SIZE,
  WALLET_READ_ODD_U64,
  WALLET_READ_OTHER_AMOUNT,
  WALLET_READ_SLOT,
  WALLET_READ_U64_MAX,
} from './rpcWalletReadTestData';
import {
  createWalletReadFixture,
  expectWalletReadError,
  type WalletReadTokenFixture,
  walletReadInventoryRaw,
  walletReadKey,
} from './rpcWalletReadTestUtils';

describe('createSolanaRpcWalletReadProducer', () => {
  /**
   * @target createSolanaRpcWalletReadProducer returned reader decodes complete account inventory and emits exact immutable DTOs
   * @dependencies one local JSON-RPC transcript containing initialized, frozen and wrapped-SOL accounts
   * @scenario read two accounts of one mint and one wrapped-SOL account at matching finalized slots
   * @expected all raw bigint balances, per-mint decimals, frozen state and wrapped-SOL entry remain unfiltered
   */
  it('decodes complete account inventory and emits exact immutable DTOs', async () => {
    const mint = walletReadKey(20);
    const accounts: WalletReadTokenFixture[] = [
      {
        address: walletReadKey(30),
        mint,
        amount: WALLET_READ_ODD_U64,
        decimals: 9,
      },
      {
        address: walletReadKey(31),
        mint,
        amount: WALLET_READ_OTHER_AMOUNT,
        decimals: 9,
        state: 'frozen',
      },
      {
        address: walletReadKey(32),
        mint: 'So11111111111111111111111111111111111111112',
        amount: 44n,
        decimals: 9,
        nativeReserve: 890n,
      },
    ];
    const fixture = createWalletReadFixture({
      tokenAccounts: accounts,
      nativeBalance: WALLET_READ_U64_MAX.toString(),
    });
    const result = (await fixture.producer({
      ...fixture.request,
      minContextSlot: WALLET_READ_FLOOR,
    })) as SolanaWalletReadResult;

    expect(result).toEqual({
      address: fixture.walletAddress,
      clusterGenesisHash: fixture.genesisHash,
      commitment: 'finalized',
      nativeContextSlot: WALLET_READ_SLOT,
      tokenContextSlot: WALLET_READ_SLOT,
      nativeBalance: WALLET_READ_U64_MAX,
      tokenAccounts: [
        {
          address: accounts[0].address,
          mint,
          programId: SOLANA_SPL_PROGRAM_ID,
          owner: fixture.walletAddress,
          amount: WALLET_READ_ODD_U64,
          decimals: 9,
          state: 'initialized',
        },
        {
          address: accounts[1].address,
          mint,
          programId: SOLANA_SPL_PROGRAM_ID,
          owner: fixture.walletAddress,
          amount: WALLET_READ_OTHER_AMOUNT,
          decimals: 9,
          state: 'frozen',
        },
        {
          address: accounts[2].address,
          mint: 'So11111111111111111111111111111111111111112',
          programId: SOLANA_SPL_PROGRAM_ID,
          owner: fixture.walletAddress,
          amount: 44n,
          decimals: 9,
          state: 'initialized',
        },
      ],
    });
    expect(Object.isFrozen(result)).toEqual(true);
    expect(Object.isFrozen(result.tokenAccounts)).toEqual(true);
    expect(result.tokenAccounts.every(Object.isFrozen)).toEqual(true);
    expect(fixture.requests.map((request) => request.method)).toEqual([
      'getGenesisHash',
      'getBalance',
      'getTokenAccountsByOwner',
      'getMultipleAccounts',
      'getGenesisHash',
    ]);
    expect(fixture.requests[1].params).toEqual([
      fixture.walletAddress,
      { commitment: 'finalized', minContextSlot: WALLET_READ_FLOOR },
    ]);
    expect(fixture.requests[2].params).toEqual([
      fixture.walletAddress,
      { programId: SOLANA_SPL_PROGRAM_ID },
      { commitment: 'finalized', encoding: 'base64', minContextSlot: WALLET_READ_FLOOR },
    ]);
    expect(fixture.requests[3].params).toEqual([
      [mint, 'So11111111111111111111111111111111111111112'],
      { commitment: 'finalized', encoding: 'base64', minContextSlot: WALLET_READ_SLOT },
    ]);
  });

  /**
   * @target createSolanaRpcWalletReadProducer returned reader accepts an empty original-SPL inventory
   * @dependencies one finalized native balance and one empty original-SPL owner result
   * @scenario read a wallet that owns no original-SPL token accounts
   * @expected empty frozen token list, matching native/token context and no getMultipleAccounts request
   */
  it('accepts an empty original-SPL inventory', async () => {
    const fixture = createWalletReadFixture();
    const result = (await fixture.producer(fixture.request)) as SolanaWalletReadResult;

    expect(result.nativeBalance).toEqual(WALLET_READ_ODD_U64);
    expect(result.tokenAccounts).toEqual([]);
    expect(Object.isFrozen(result.tokenAccounts)).toEqual(true);
    expect(fixture.requests.map((request) => request.method)).toEqual([
      'getGenesisHash',
      'getBalance',
      'getTokenAccountsByOwner',
      'getGenesisHash',
    ]);
  });

  /**
   * @target createSolanaRpcWalletReadProducer returned reader rejects unequal and below-floor context pairs
   * @dependencies independent raw replies with unequal slots and one context below the requested floor
   * @scenario compare native and original-SPL context after parsing exact integer slot lexemes
   * @expected unequal slots and below-floor slots fail without returning partial balances
   */
  it('rejects unequal and below-floor context pairs', async () => {
    const unequal = createWalletReadFixture({
      balanceSlot: WALLET_READ_SLOT.toString(),
      tokenSlot: (WALLET_READ_SLOT + 1n).toString(),
    });
    await expectWalletReadError(
      () => unequal.producer(unequal.request),
      'SOLANA_RPC_WALLET_READ_CONTEXT_SLOT_MISMATCH',
    );
    expect(unequal.requests.map((request) => request.method)).toEqual([
      'getGenesisHash',
      'getBalance',
      'getTokenAccountsByOwner',
      'getGenesisHash',
    ]);

    const belowFloor = createWalletReadFixture({
      balanceSlot: (WALLET_READ_FLOOR - 1n).toString(),
    });
    await expectWalletReadError(
      () => belowFloor.producer(belowFloor.request),
      'SOLANA_RPC_WALLET_READ_CONTEXT_BELOW_FLOOR',
    );
    expect(belowFloor.requests.map((request) => request.method)).toEqual([
      'getGenesisHash',
      'getBalance',
      'getGenesisHash',
    ]);
  });

  /**
   * @target createSolanaRpcWalletReadProducer returned reader rejects mint metadata from a different context slot
   * @dependencies one valid owner inventory and one independently valid but later mint context
   * @scenario read the mint metadata after native and token-account calls have matched
   * @expected a later mint slot fails the whole inventory rather than relabeling its context
   */
  it('rejects mint metadata from a different context slot', async () => {
    const fixture = createWalletReadFixture({
      tokenAccounts: [
        { address: walletReadKey(50), mint: walletReadKey(51), amount: 7n, decimals: 6 },
      ],
      mintSlots: [(WALLET_READ_SLOT + 1n).toString()],
    });
    await expectWalletReadError(
      () => fixture.producer(fixture.request),
      'SOLANA_RPC_WALLET_READ_MINT_CONTEXT_SLOT_MISMATCH',
    );
    expect(fixture.requests.map((request) => request.method)).toEqual([
      'getGenesisHash',
      'getBalance',
      'getTokenAccountsByOwner',
      'getMultipleAccounts',
      'getGenesisHash',
    ]);
  });

  /**
   * @target createSolanaRpcWalletReadProducer returned reader reads all mints in bounded 100-account batches without truncation
   * @dependencies 101 complete unique token-account layouts and 101 initialized mint layouts
   * @scenario read an inventory requiring two getMultipleAccounts responses
   * @expected every account is retained and batch lengths are exactly 100 and 1
   */
  it('reads all mints in bounded 100-account batches without truncation', async () => {
    const accounts = Array.from({ length: WALLET_READ_BATCH_FALSIFIER_COUNT }, (_, index) => ({
      address: walletReadKey(1000 + index),
      mint: walletReadKey(2000 + index),
      amount: BigInt(index + 1),
      decimals: index % 10,
    }));
    const fixture = createWalletReadFixture({ tokenAccounts: accounts });
    const result = (await fixture.producer(fixture.request)) as SolanaWalletReadResult;
    const batches = fixture.requests.filter((request) => request.method === 'getMultipleAccounts');

    expect(batches.map((request) => (request.params[0] as readonly string[]).length)).toEqual([
      WALLET_READ_MINT_BATCH_SIZE,
      1,
    ]);
    expect(result.tokenAccounts).toHaveLength(WALLET_READ_BATCH_FALSIFIER_COUNT);
    expect(result.tokenAccounts.map((account) => account.decimals)).toEqual(
      accounts.map((account) => account.decimals),
    );
    expect(result.tokenAccounts.map((account) => account.amount)).toEqual(
      accounts.map((account) => account.amount),
    );
  });

  /**
   * @target createSolanaRpcWalletReadProducer returned reader rejects duplicate inventory account addresses
   * @dependencies two syntactically valid full token accounts that repeat one account address
   * @scenario parse all owner rows before requesting account details for their mints
   * @expected duplicate identity fails the complete read and no mint request is sent
   */
  it('rejects duplicate inventory account addresses', async () => {
    const address = walletReadKey(70);
    const fixture = createWalletReadFixture({
      tokenAccounts: [
        { address, mint: walletReadKey(71), amount: 1n, decimals: 6 },
        { address, mint: walletReadKey(72), amount: 2n, decimals: 6 },
      ],
    });
    await expectWalletReadError(
      () => fixture.producer(fixture.request),
      'SOLANA_RPC_WALLET_READ_DUPLICATE_ACCOUNT',
    );
    expect(fixture.requests.map((request) => request.method)).toEqual([
      'getGenesisHash',
      'getBalance',
      'getTokenAccountsByOwner',
      'getGenesisHash',
    ]);
  });

  /**
   * @target createSolanaRpcWalletReadProducer returned reader rejects malformed nonallowlisted token-account bytes
   * @dependencies one malformed original-program account for a mint no bridge policy names
   * @scenario return an invalid state tag in an otherwise complete 165-byte token account
   * @expected decoder rejects the malformed nonallowlisted row before requesting mint metadata
   */
  it('rejects malformed nonallowlisted token-account bytes', async () => {
    const fixture = createWalletReadFixture({
      tokenAccounts: [
        {
          address: walletReadKey(80),
          mint: walletReadKey(81),
          amount: 1n,
          decimals: 6,
          rawStateTag: 0,
        },
      ],
    });
    await expectWalletReadError(
      () => fixture.producer(fixture.request),
      'SOLANA_ASSET_ACCOUNT_STATE_INVALID',
    );
    expect(fixture.requests.some((request) => request.method === 'getMultipleAccounts')).toEqual(
      false,
    );
  });

  /**
   * @target createSolanaRpcWalletReadProducer returned reader rejects inventory one entry over the 4096 account budget
   * @dependencies 4097 named short rows that fit the parser's byte budget
   * @scenario enforce the structural account-count cap before decoding or selecting rows
   * @expected the over-cap inventory fails as a whole without retry; larger full rows may hit the parser or transport byte cap first
   */
  it('rejects inventory one entry over the 4096 account budget', async () => {
    const rows = Array.from(
      { length: WALLET_READ_MAX_ACCOUNTS + 1 },
      (_, index) => `{"pubkey":${JSON.stringify(walletReadKey(10_000 + index))},"account":{}}`,
    );
    const fixture = createWalletReadFixture({ tokenInventoryRaw: `[${rows.join(',')}]` });
    await expectWalletReadError(
      () => fixture.producer(fixture.request),
      'SOLANA_RPC_WALLET_READ_INVENTORY_LIMIT',
    );
    expect(fixture.requests.map((request) => request.method)).toEqual([
      'getGenesisHash',
      'getBalance',
      'getTokenAccountsByOwner',
      'getGenesisHash',
    ]);
  });

  /**
   * @target createSolanaRpcWalletReadProducer returned reader rejects malformed %s account metadata before decoding account bytes
   * @dependencies one valid account layout with one independently malformed full RPC account field
   * @scenario validate every account metadata field before passing the layout to the binary decoder
   * @expected malformed metadata rejects the complete read without retry or a partial result
   */
  it.each([
    [
      'owner',
      `"owner":${JSON.stringify(SOLANA_SPL_PROGRAM_ID)}`,
      '"owner":"not-a-canonical-key"',
      'SOLANA_RPC_WALLET_READ_ACCOUNT_INVALID',
    ],
    [
      'executable',
      '"executable":false',
      '"executable":0',
      'SOLANA_RPC_WALLET_READ_ACCOUNT_INVALID',
    ],
    ['lamports', '"lamports":1', '"lamports":1.5', 'SOLANA_RPC_INVALID_U64'],
    ['rentEpoch', '"rentEpoch":0', '"rentEpoch":-1', 'SOLANA_RPC_INVALID_U64'],
    ['space', '"space":165', '"space":1e3', 'SOLANA_RPC_INVALID_U64'],
    ['data encoding', '"base64"]', '"base58"]', 'SOLANA_RPC_WALLET_READ_ACCOUNT_INVALID'],
  ])(
    'rejects malformed %s account metadata before decoding account bytes',
    async (_field, original, malformedField, code) => {
      const account: WalletReadTokenFixture = {
        address: walletReadKey(90),
        mint: walletReadKey(91),
        amount: 1n,
        decimals: 6,
      };
      const walletAddress = walletReadKey(9000);
      const valid = walletReadInventoryRaw([account], walletAddress);
      const malformed = valid.replace(original, malformedField);
      expect(malformed).not.toEqual(valid);
      const fixture = createWalletReadFixture({ tokenInventoryRaw: malformed });
      await expectWalletReadError(() => fixture.producer(fixture.request), code);
      expect(fixture.requests.map((request) => request.method)).toEqual([
        'getGenesisHash',
        'getBalance',
        'getTokenAccountsByOwner',
        'getGenesisHash',
      ]);
    },
  );

  /**
   * @target createSolanaRpcWalletReadProducer returned reader rejects a missing mint account response
   * @dependencies one valid token inventory and one short non-null mint response
   * @scenario return no mint entry for a requested account while preserving the matched response slot
   * @expected the incomplete response rejects the whole inventory
   */
  it('rejects a missing mint account response', async () => {
    const fixture = createWalletReadFixture({
      tokenAccounts: [
        { address: walletReadKey(100), mint: walletReadKey(101), amount: 1n, decimals: 6 },
      ],
      mintValuesRaw: () => '[]',
    });
    await expectWalletReadError(
      () => fixture.producer(fixture.request),
      'SOLANA_RPC_WALLET_READ_MINT_RESPONSE_INVALID',
    );
  });

  /**
   * @target createSolanaRpcWalletReadProducer returned reader rejects cluster drift after inventory and preserves data-read failures
   * @dependencies one correct pre-read identity and one changed post-read identity
   * @scenario change endpoint identity only after native, token-account and mint data were read
   * @expected no result is returned after endpoint cluster drift
   */
  it('rejects cluster drift after inventory and preserves data-read failures', async () => {
    const fixture = createWalletReadFixture({
      genesisResults: [fixtureGenesis(), walletReadKey(9002)],
    });
    await expectWalletReadError(
      () => fixture.producer(fixture.request),
      'SOLANA_RPC_WALLET_READ_GENESIS_MISMATCH',
    );

    const transportError = new Error('synthetic transport failure');
    const failedRead = createWalletReadFixture({
      transportError: (request) => (request.method === 'getBalance' ? transportError : undefined),
    });
    let caught: unknown;
    try {
      await failedRead.producer(failedRead.request);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(transportError);
    expect(failedRead.requests.map((request) => request.method)).toEqual([
      'getGenesisHash',
      'getBalance',
      'getGenesisHash',
    ]);
  });

  /**
   * @target createSolanaRpcWalletReadProducer returned reader captures configuration and request values before asynchronous RPC work
   * @dependencies one delayed local genesis response and mutable caller-owned config/request objects
   * @scenario change address, context floor, genesis and transport while initial identity response is pending
   * @expected all RPC parameters and cluster checks continue using the original captured values and transport
   */
  it('captures configuration and request values before asynchronous RPC work', async () => {
    const fixture = createWalletReadFixture();
    let releaseFirst!: () => void;
    let markEntered!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    let firstRequest = true;
    const configuration = {
      expectedGenesisHash: fixture.genesisHash,
      transport: async (request: (typeof fixture.requests)[number]) => {
        if (firstRequest) {
          firstRequest = false;
          markEntered();
          await gate;
        }
        return fixture.transport(request);
      },
    };
    const producer = createSolanaRpcWalletReadProducer(configuration);
    const request: {
      address: string;
      clusterGenesisHash: string;
      commitment: 'finalized';
      minContextSlot: bigint;
    } = { ...fixture.request };
    const pending = producer(request);
    await entered;
    const changedAddress = walletReadKey(9003);
    configuration.expectedGenesisHash = walletReadKey(9004);
    configuration.transport = async () => {
      throw new Error('replacement transport must not run');
    };
    request.address = changedAddress;
    request.clusterGenesisHash = walletReadKey(9004);
    request.minContextSlot = 0n;
    releaseFirst();
    const result = (await pending) as SolanaWalletReadResult;

    expect(result.address).toEqual(fixture.walletAddress);
    expect(fixture.requests[1].params).toEqual([
      fixture.walletAddress,
      { commitment: 'finalized', minContextSlot: WALLET_READ_FLOOR },
    ]);
  });
});

/** Returns the deterministic expected genesis hash for the wallet-read fixture. */
const fixtureGenesis = (): string => walletReadKey(9001);
