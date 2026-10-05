import { describe, expect, it, vi } from 'vitest';

import {
  isCurrentSolanaWalletBalanceView,
  readSolanaWalletBalance,
  selectSolanaSourceTokenAccount,
} from '../src/readPort';
import {
  invalidateMockReadPortSession,
  mockReadPortProducer,
  mockReadPortSession,
} from './mocked/readPort.mock';
import { readPortTestData } from './readPortTestData';
import {
  createReadPortInventory,
  createReadPortProfile,
  createReadPortResult,
  deferredReadPortResult,
} from './readPortTestUtils';
import { keypair } from './testUtils';

vi.mock('../src/eventBoundWalletPort', async () => {
  const mocked = await import('./mocked/readPort.mock');
  return { isCurrentSolanaWalletSession: mocked.mockIsCurrentReadPortSession };
});

describe('readSolanaWalletBalance', () => {
  /**
   * @target readSolanaWalletBalance accepts zero and maximum u64 boundaries without scaling
   * @dependencies fully mocked read producer and session connector
   * @scenario read an empty zero balance then maximum raw balances and context slots
   * @expected exact bigint boundary values retained
   */
  it('accepts zero and maximum u64 boundaries without scaling', async () => {
    const session = mockReadPortSession(keypair(1).publicKey.toBase58());
    const result = createReadPortResult();
    const empty = await readSolanaWalletBalance(
      createReadPortProfile(),
      session,
      mockReadPortProducer({
        ...result,
        nativeBalance: 0n,
        nativeContextSlot: 0n,
        tokenContextSlot: 0n,
        tokenAccounts: [],
      }),
    );
    expect(empty.nativeBalance).toEqual(0n);
    expect(empty.contextSlot).toEqual(0n);
    expect(empty.tokenAccounts).toEqual([]);
    const maximum = await readSolanaWalletBalance(
      createReadPortProfile(),
      session,
      mockReadPortProducer({
        ...result,
        nativeBalance: readPortTestData.maximumU64,
        nativeContextSlot: readPortTestData.maximumU64,
        tokenContextSlot: readPortTestData.maximumU64,
        tokenAccounts: [
          { ...result.tokenAccounts[0], amount: readPortTestData.maximumU64, decimals: 0 },
        ],
      }),
    );
    expect(maximum.nativeBalance).toEqual(readPortTestData.maximumU64);
    expect(maximum.contextSlot).toEqual(readPortTestData.maximumU64);
    expect(maximum.tokenAccounts[0].amount).toEqual(readPortTestData.maximumU64);
    expect(maximum.tokenAccounts[0].decimals).toEqual(0);
  });

  /**
   * @target readSolanaWalletBalance accepts exactly 4096 accounts and rejects 4097
   * @dependencies fully mocked read producer and session connector
   * @scenario supply unique otherwise valid account inventories at each size boundary
   * @expected complete bounded inventory or explicit size refusal
   */
  it('accepts exactly 4096 accounts and rejects 4097', async () => {
    const session = mockReadPortSession(keypair(1).publicKey.toBase58());
    const result = createReadPortResult();
    const view = await readSolanaWalletBalance(
      createReadPortProfile(),
      session,
      mockReadPortProducer({ ...result, tokenAccounts: createReadPortInventory(4096) }),
    );
    expect(view.tokenAccounts.length).toEqual(4096);
    await expect(
      readSolanaWalletBalance(
        createReadPortProfile(),
        session,
        mockReadPortProducer({ ...result, tokenAccounts: createReadPortInventory(4097) }),
      ),
    ).rejects.toThrow('4096');
  });
  /**
   * @target readSolanaWalletBalance preserves raw amounts above Number precision
   * @dependencies fully mocked read producer and session connector
   * @scenario read one finalized SOL balance and original-SPL account with bigint amounts
   * @expected exact raw amounts and immutable request matching the captured session/profile
   */
  it('preserves raw amounts above Number precision', async () => {
    const profile = createReadPortProfile();
    const session = mockReadPortSession(keypair(1).publicKey.toBase58());
    const producer = mockReadPortProducer(createReadPortResult());
    const view = await readSolanaWalletBalance(profile, session, producer);
    expect(view.nativeBalance).toEqual(readPortTestData.nativeBalance);
    expect(view.tokenAccounts[0].amount).toEqual(readPortTestData.tokenAmount);
    expect(view.contextSlot).toEqual(readPortTestData.contextSlot);
    expect(producer).toHaveBeenCalledExactlyOnceWith({
      address: session.publicKey,
      clusterGenesisHash: profile.clusterGenesisHash,
      commitment: 'finalized',
    });
    expect(Object.isFrozen(producer.mock.calls[0][0])).toEqual(true);
  });

  /**
   * @target readSolanaWalletBalance rejects uncaptured profiles and copied sessions before reading
   * @dependencies fully mocked read producer and session connector
   * @scenario pass a spread copy of either branded input
   * @expected no producer invocation
   */
  it('rejects uncaptured profiles and copied sessions before reading', async () => {
    const profile = createReadPortProfile();
    const session = mockReadPortSession(keypair(1).publicKey.toBase58());
    const producer = mockReadPortProducer(createReadPortResult());
    await expect(readSolanaWalletBalance({ ...profile }, session, producer)).rejects.toThrow(
      'not captured',
    );
    await expect(readSolanaWalletBalance(profile, { ...session }, producer)).rejects.toThrow(
      'stale',
    );
    expect(producer).not.toHaveBeenCalled();
  });

  /**
   * @target readSolanaWalletBalance rejects invalid result field %s
   * @dependencies fully mocked read producer and session connector
   * @scenario change exactly one result scalar to an invalid value
   * @expected refusal without a captured balance view
   */
  it.each([
    ['address malformed', 'address', 'bad-key'],
    ['address number', 'address', 1],
    ['nativeBalance number', 'nativeBalance', 9007199254740992],
    ['nativeBalance string', 'nativeBalance', '9007199254740993'],
    ['nativeBalance negative', 'nativeBalance', -1n],
    ['nativeBalance overflow', 'nativeBalance', readPortTestData.maximumU64 + 1n],
    ['native slot number', 'nativeContextSlot', 42],
    ['native slot negative', 'nativeContextSlot', -1n],
    ['native slot overflow', 'nativeContextSlot', readPortTestData.maximumU64 + 1n],
    ['token slot string', 'tokenContextSlot', '42'],
    ['token slot negative', 'tokenContextSlot', -1n],
    ['token slot overflow', 'tokenContextSlot', readPortTestData.maximumU64 + 1n],
    ['different context slot', 'tokenContextSlot', 43n],
    ['unfinalized commitment', 'commitment', 'confirmed'],
    ['malformed genesis', 'clusterGenesisHash', 'bad-key'],
  ])('rejects invalid result field %s', async (_label, field, value) => {
    const session = mockReadPortSession(keypair(1).publicKey.toBase58());
    const response = { ...createReadPortResult(), [field as string]: value };
    await expect(
      readSolanaWalletBalance(createReadPortProfile(), session, mockReadPortProducer(response)),
    ).rejects.toThrow();
  });

  /**
   * @target readSolanaWalletBalance rejects a canonical genesis from another cluster
   * @dependencies fully mocked read producer and session connector
   * @scenario return another canonical public key for genesis
   * @expected captured profile cluster mismatch refusal
   */
  it('rejects a canonical genesis from another cluster', async () => {
    const session = mockReadPortSession(keypair(1).publicKey.toBase58());
    const response = {
      ...createReadPortResult(),
      clusterGenesisHash: keypair(8).publicKey.toBase58(),
    };
    await expect(
      readSolanaWalletBalance(createReadPortProfile(), session, mockReadPortProducer(response)),
    ).rejects.toThrow('cluster');
  });

  /**
   * @target readSolanaWalletBalance rejects a native-only reply for another wallet
   * @dependencies fully mocked read producer and session connector
   * @scenario return a different canonical address with no token accounts
   * @expected explicit request to response authority mismatch refusal
   */
  it('rejects a native-only reply for another wallet', async () => {
    const session = mockReadPortSession(keypair(1).publicKey.toBase58());
    const response = {
      ...createReadPortResult(),
      address: keypair(2).publicKey.toBase58(),
      tokenAccounts: [],
    };
    await expect(
      readSolanaWalletBalance(createReadPortProfile(), session, mockReadPortProducer(response)),
    ).rejects.toThrow('address differs');
  });

  /**
   * @target readSolanaWalletBalance rejects result accessors without invoking them
   * @dependencies fully mocked read producer and session connector
   * @scenario replace nativeBalance with a getter that would return a valid amount
   * @expected zero getter calls and accessor refusal
   */
  it('rejects result accessors without invoking them', async () => {
    const getter = vi.fn(() => readPortTestData.nativeBalance);
    const response = createReadPortResult();
    Object.defineProperty(response, 'nativeBalance', { get: getter, enumerable: true });
    const session = mockReadPortSession(keypair(1).publicKey.toBase58());
    await expect(
      readSolanaWalletBalance(createReadPortProfile(), session, mockReadPortProducer(response)),
    ).rejects.toThrow('accessor');
    expect(getter).not.toHaveBeenCalled();
  });

  /**
   * @target readSolanaWalletBalance rejects unknown, symbol, inherited and missing result fields
   * @dependencies fully mocked read producer and session connector
   * @scenario provide each incompatible result shape separately
   * @expected every shape refused
   */
  it('rejects unknown, symbol, inherited and missing result fields', async () => {
    const result = createReadPortResult();
    const { nativeBalance: _omitted, ...missing } = result;
    const cases = [
      { ...result, extra: true },
      { ...result, [Symbol('extra')]: true },
      Object.create(result),
      missing,
      null,
      [],
    ];
    const session = mockReadPortSession(keypair(1).publicKey.toBase58());
    for (const response of cases)
      await expect(
        readSolanaWalletBalance(createReadPortProfile(), session, mockReadPortProducer(response)),
      ).rejects.toThrow();
  });

  /**
   * @target readSolanaWalletBalance accepts null-prototype own data records
   * @dependencies fully mocked read producer and session connector
   * @scenario supply a null-prototype root result and token account record
   * @expected ordinary immutable copied view
   */
  it('accepts null-prototype own data records', async () => {
    const result = createReadPortResult();
    const response = Object.assign(Object.create(null), result, {
      tokenAccounts: [Object.assign(Object.create(null), result.tokenAccounts[0])],
    });
    const session = mockReadPortSession(keypair(1).publicKey.toBase58());
    const view = await readSolanaWalletBalance(
      createReadPortProfile(),
      session,
      mockReadPortProducer(response),
    );
    expect(view.nativeBalance).toEqual(readPortTestData.nativeBalance);
  });

  /**
   * @target readSolanaWalletBalance rejects invalid account field %s
   * @dependencies fully mocked read producer and session connector
   * @scenario modify one field in an otherwise valid token account
   * @expected refusal even when account would be excluded by selection
   */
  it.each([
    ['address', 'address', 'bad-key'],
    ['mint', 'mint', 'bad-key'],
    ['program malformed', 'programId', 'bad-key'],
    ['owner malformed', 'owner', 'bad-key'],
    ['amount number', 'amount', 10],
    ['amount string', 'amount', '10'],
    ['amount negative', 'amount', -1n],
    ['amount overflow', 'amount', readPortTestData.maximumU64 + 1n],
    ['decimals fractional', 'decimals', 6.5],
    ['decimals string', 'decimals', '6'],
    ['decimals negative', 'decimals', -1],
    ['decimals overflow', 'decimals', 256],
    ['state', 'state', 'uninitialized'],
  ])('rejects invalid account field %s', async (_label, field, value) => {
    const result = createReadPortResult();
    const response = {
      ...result,
      tokenAccounts: [{ ...result.tokenAccounts[0], [field as string]: value }],
    };
    const session = mockReadPortSession(keypair(1).publicKey.toBase58());
    await expect(
      readSolanaWalletBalance(createReadPortProfile(), session, mockReadPortProducer(response)),
    ).rejects.toThrow();
  });

  /**
   * @target readSolanaWalletBalance rejects a valid unrelated account %s
   * @dependencies fully mocked read producer and session connector
   * @scenario replace only the program or owner with a different canonical key
   * @expected precise program or session-owner policy mismatch
   */
  it.each([
    ['program', 'programId', 'Unsupported token account program'],
    ['owner', 'owner', 'Token account owner differs from wallet session'],
  ])('rejects a valid unrelated account %s', async (_label, field, message) => {
    const result = createReadPortResult();
    const response = {
      ...result,
      tokenAccounts: [{ ...result.tokenAccounts[0], [field]: keypair(2).publicKey.toBase58() }],
    };
    const session = mockReadPortSession(keypair(1).publicKey.toBase58());
    await expect(
      readSolanaWalletBalance(createReadPortProfile(), session, mockReadPortProducer(response)),
    ).rejects.toMatchObject({ name: 'TypeError', message });
  });

  /**
   * @target readSolanaWalletBalance validates raw amounts before excluding %s inventory
   * @dependencies fully mocked read producer and session connector
   * @scenario give one frozen or wrapped-SOL account a number amount instead of bigint
   * @expected precise raw token amount refusal before bridge eligibility selection
   */
  it.each(['frozen', 'wrapped-SOL'] as const)(
    'validates raw amounts before excluding %s inventory',
    async (kind) => {
      const result = createReadPortResult();
      const account = {
        ...result.tokenAccounts[0],
        ...(kind === 'frozen' ? { state: 'frozen' } : { mint: readPortTestData.wrappedSolMint }),
        amount: 10,
      };
      const session = mockReadPortSession(keypair(1).publicKey.toBase58());
      await expect(
        readSolanaWalletBalance(
          createReadPortProfile(),
          session,
          mockReadPortProducer({ ...result, tokenAccounts: [account] }),
        ),
      ).rejects.toMatchObject({ name: 'TypeError', message: 'Invalid raw token amount' });
    },
  );

  /**
   * @target readSolanaWalletBalance rejects a nonfunction producer before reading
   * @dependencies fully mocked session connector
   * @scenario use a current session and captured profile with undefined producer
   * @expected precise producer type refusal
   */
  it('rejects a nonfunction producer before reading', async () => {
    const session = mockReadPortSession(keypair(1).publicKey.toBase58());
    await expect(
      readSolanaWalletBalance(createReadPortProfile(), session, undefined as never),
    ).rejects.toMatchObject({ name: 'TypeError', message: 'Invalid Solana wallet read producer' });
  });

  /**
   * @target readSolanaWalletBalance rejects invalid token inventory structures
   * @dependencies fully mocked read producer and session connector
   * @scenario separately supply duplicate, sparse, extended, accessor arrays
   * @expected no silent truncation or partially accepted inventory
   */
  it('rejects invalid token inventory structures', async () => {
    const result = createReadPortResult();
    const getter = vi.fn(() => result.tokenAccounts[0]);
    const accessor: unknown[] = [];
    Object.defineProperty(accessor, '0', { get: getter });
    const extended = Object.assign([...result.tokenAccounts], { extra: true });
    const symbolExtended = Object.assign([...result.tokenAccounts], { [Symbol('extra')]: true });
    const cases = [
      [result.tokenAccounts[0], result.tokenAccounts[0]],
      Array(1),
      extended,
      symbolExtended,
      accessor,
      {},
    ];
    const session = mockReadPortSession(keypair(1).publicKey.toBase58());
    for (const tokenAccounts of cases)
      await expect(
        readSolanaWalletBalance(
          createReadPortProfile(),
          session,
          mockReadPortProducer({ ...result, tokenAccounts }),
        ),
      ).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled();
  });

  /**
   * @target readSolanaWalletBalance rejects a modified token inventory prototype
   * @dependencies fully mocked read producer and session connector
   * @scenario retain dense own array data but replace its prototype
   * @expected precise inventory prototype refusal
   */
  it('rejects a modified token inventory prototype', async () => {
    const result = createReadPortResult();
    const tokenAccounts = [...result.tokenAccounts];
    Object.setPrototypeOf(tokenAccounts, null);
    const session = mockReadPortSession(keypair(1).publicKey.toBase58());
    await expect(
      readSolanaWalletBalance(
        createReadPortProfile(),
        session,
        mockReadPortProducer({ ...result, tokenAccounts }),
      ),
    ).rejects.toMatchObject({ name: 'TypeError', message: 'Invalid token account inventory' });
  });

  /**
   * @target readSolanaWalletBalance rejects a token inventory hole with matching descriptor count
   * @dependencies fully mocked read producer and session connector
   * @scenario pad one array hole with one extra own data field so the count check passes
   * @expected precise missing-index refusal
   */
  it('rejects a token inventory hole with matching descriptor count', async () => {
    const result = createReadPortResult();
    const tokenAccounts = Object.assign(Array(1), { padding: result.tokenAccounts[0] });
    expect(Reflect.ownKeys(tokenAccounts).length).toEqual(tokenAccounts.length + 1);
    const session = mockReadPortSession(keypair(1).publicKey.toBase58());
    await expect(
      readSolanaWalletBalance(
        createReadPortProfile(),
        session,
        mockReadPortProducer({ ...result, tokenAccounts }),
      ),
    ).rejects.toMatchObject({
      name: 'TypeError',
      message: 'Invalid token account inventory accessor or hole',
    });
  });

  /**
   * @target readSolanaWalletBalance rejects token record accessors and unknown fields
   * @dependencies fully mocked read producer and session connector
   * @scenario supply a getter, symbol field, inherited record and unknown field separately
   * @expected no getter execution and no account accepted
   */
  it('rejects token record accessors and unknown fields', async () => {
    const result = createReadPortResult();
    const getter = vi.fn(() => readPortTestData.tokenAmount);
    const accessor = { ...result.tokenAccounts[0] };
    Object.defineProperty(accessor, 'amount', { get: getter });
    const cases = [
      accessor,
      { ...result.tokenAccounts[0], extra: true },
      { ...result.tokenAccounts[0], [Symbol('extra')]: true },
      Object.create(result.tokenAccounts[0]),
    ];
    const session = mockReadPortSession(keypair(1).publicKey.toBase58());
    for (const account of cases)
      await expect(
        readSolanaWalletBalance(
          createReadPortProfile(),
          session,
          mockReadPortProducer({ ...result, tokenAccounts: [account] }),
        ),
      ).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled();
  });

  /**
   * @target readSolanaWalletBalance copies immutable inventory including frozen and unsupported mints
   * @dependencies fully mocked read producer and session connector
   * @scenario retain WSOL and a frozen account with u8 decimals then mutate producer records
   * @expected complete detached inventory remains unchanged and every container is frozen
   */
  it('copies immutable inventory including frozen and unsupported mints', async () => {
    const result = createReadPortResult();
    const account = {
      ...result.tokenAccounts[0],
      mint: readPortTestData.wrappedSolMint,
      decimals: 255,
      state: 'frozen',
    };
    const response = { ...result, tokenAccounts: [account] };
    const session = mockReadPortSession(keypair(1).publicKey.toBase58());
    const view = await readSolanaWalletBalance(
      createReadPortProfile(),
      session,
      mockReadPortProducer(response),
    );
    account.amount = 0n;
    response.tokenAccounts.length = 0;
    expect(view.tokenAccounts[0]).toEqual({
      ...result.tokenAccounts[0],
      mint: readPortTestData.wrappedSolMint,
      decimals: 255,
      state: 'frozen',
    });
    expect([view, view.tokenAccounts, view.tokenAccounts[0]].every(Object.isFrozen)).toEqual(true);
  });

  /**
   * @target readSolanaWalletBalance rejects invalidation during a pending read
   * @dependencies fully mocked deferred producer and session connector
   * @scenario invalidate originating generation before completing the service request
   * @expected stale-session refusal
   */
  it('rejects invalidation during a pending read', async () => {
    const session = mockReadPortSession(keypair(1).publicKey.toBase58());
    const deferred = deferredReadPortResult();
    const pending = readSolanaWalletBalance(
      createReadPortProfile(),
      session,
      vi.fn(() => deferred.promise),
    );
    invalidateMockReadPortSession(session);
    deferred.resolve(createReadPortResult());
    await expect(pending).rejects.toThrow('stale');
  });

  /**
   * @target readSolanaWalletBalance preserves producer failure without retry
   * @dependencies fully mocked rejected producer and session connector
   * @scenario service rejects an unavailable finalized read
   * @expected original error identity and one invocation
   */
  it('preserves producer failure without retry', async () => {
    const failure = new Error('Read unavailable');
    const producer = mockReadPortProducer(undefined).mockRejectedValue(failure);
    const session = mockReadPortSession(keypair(1).publicKey.toBase58());
    await expect(readSolanaWalletBalance(createReadPortProfile(), session, producer)).rejects.toBe(
      failure,
    );
    expect(producer).toHaveBeenCalledTimes(1);
  });

  /**
   * @target readSolanaWalletBalance refuses invalidation during descriptor capture
   * @dependencies fully mocked read producer and session connector
   * @scenario a descriptor trap invalidates the session while a structurally valid result is captured
   * @expected final session check rejects before returning a balance view
   */
  it('refuses invalidation during descriptor capture', async () => {
    const session = mockReadPortSession(keypair(1).publicKey.toBase58());
    const response = new Proxy(createReadPortResult(), {
      getOwnPropertyDescriptor: (target, property) => {
        if (property === 'nativeBalance') invalidateMockReadPortSession(session);
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    await expect(
      readSolanaWalletBalance(createReadPortProfile(), session, mockReadPortProducer(response)),
    ).rejects.toThrow('stale');
  });
});

describe('isCurrentSolanaWalletBalanceView', () => {
  /**
   * @target isCurrentSolanaWalletBalanceView rejects copied views and stale originating sessions
   * @dependencies fully mocked read producer and session connector
   * @scenario copy a captured view then invalidate its original session
   * @expected only the original current view is initially accepted
   */
  it('rejects copied views and stale originating sessions', async () => {
    const session = mockReadPortSession(keypair(1).publicKey.toBase58());
    const view = await readSolanaWalletBalance(
      createReadPortProfile(),
      session,
      mockReadPortProducer(createReadPortResult()),
    );
    expect(isCurrentSolanaWalletBalanceView(view)).toEqual(true);
    expect(isCurrentSolanaWalletBalanceView({ ...view })).toEqual(false);
    expect(isCurrentSolanaWalletBalanceView(null)).toEqual(false);
    invalidateMockReadPortSession(session);
    expect(isCurrentSolanaWalletBalanceView(view)).toEqual(false);
  });
});

describe('selectSolanaSourceTokenAccount', () => {
  /**
   * @target selectSolanaSourceTokenAccount rejects an existing named account holding another mint
   * @dependencies fully mocked read producer and session connector
   * @scenario retain the account address with another valid mint and request the allowlisted mint
   * @expected precise account-to-mint mismatch after allowlist validation succeeds
   */
  it('rejects an existing named account holding another mint', async () => {
    const result = createReadPortResult();
    const account = result.tokenAccounts[0];
    const response = {
      ...result,
      tokenAccounts: [{ ...account, mint: keypair(8).publicKey.toBase58() }],
    };
    const session = mockReadPortSession(keypair(1).publicKey.toBase58());
    const view = await readSolanaWalletBalance(
      createReadPortProfile(),
      session,
      mockReadPortProducer(response),
    );
    expect(view.tokenAccounts[0].mint).toEqual(keypair(8).publicKey.toBase58());
    expect(() => selectSolanaSourceTokenAccount(view, account.mint, account.address)).toThrowError(
      new TypeError('Selected source account does not match SPL mint'),
    );
  });
  /**
   * @target selectSolanaSourceTokenAccount selects only the explicitly named account without aggregation
   * @dependencies fully mocked read producer and session connector
   * @scenario read two accounts of one mint and select the smaller named account
   * @expected its raw amount instead of the mint aggregate or largest account
   */
  it('selects only the explicitly named account without aggregation', async () => {
    const result = createReadPortResult();
    const selected = { ...result.tokenAccounts[0], amount: 5n };
    const other = { ...result.tokenAccounts[0], address: keypair(9).publicKey.toBase58() };
    const session = mockReadPortSession(keypair(1).publicKey.toBase58());
    const view = await readSolanaWalletBalance(
      createReadPortProfile(),
      session,
      mockReadPortProducer({ ...result, tokenAccounts: [selected, other] }),
    );
    expect(selectSolanaSourceTokenAccount(view, selected.mint, selected.address).amount).toEqual(
      5n,
    );
    expect(selectSolanaSourceTokenAccount(view, selected.mint, other.address).amount).toEqual(
      readPortTestData.tokenAmount,
    );
  });

  /**
   * @target selectSolanaSourceTokenAccount rejects frozen, wrong-decimal and excluded accounts
   * @dependencies fully mocked read producer and session connector
   * @scenario change exactly one account eligibility field in each raw view
   * @expected retained inventory is refused for bridge source selection
   */
  it('rejects frozen, wrong-decimal and excluded accounts', async () => {
    const result = createReadPortResult();
    const session = mockReadPortSession(keypair(1).publicKey.toBase58());
    for (const changes of [
      { state: 'frozen' },
      { decimals: 7 },
      { mint: readPortTestData.wrappedSolMint },
    ]) {
      const account = { ...result.tokenAccounts[0], ...changes };
      const view = await readSolanaWalletBalance(
        createReadPortProfile(),
        session,
        mockReadPortProducer({ ...result, tokenAccounts: [account] }),
      );
      expect(() => selectSolanaSourceTokenAccount(view, account.mint, account.address)).toThrow();
    }
  });

  /**
   * @target selectSolanaSourceTokenAccount rejects wrong account, mint, copied view and stale session
   * @dependencies fully mocked read producer and session connector
   * @scenario change the requested account or mint then copy or invalidate a genuine view
   * @expected no selected account
   */
  it('rejects wrong account, mint, copied view and stale session', async () => {
    const result = createReadPortResult();
    const account = result.tokenAccounts[0];
    const session = mockReadPortSession(keypair(1).publicKey.toBase58());
    const view = await readSolanaWalletBalance(
      createReadPortProfile(),
      session,
      mockReadPortProducer(result),
    );
    expect(() =>
      selectSolanaSourceTokenAccount(view, account.mint, keypair(9).publicKey.toBase58()),
    ).toThrow();
    expect(() =>
      selectSolanaSourceTokenAccount(view, keypair(8).publicKey.toBase58(), account.address),
    ).toThrow();
    expect(() =>
      selectSolanaSourceTokenAccount({ ...view }, account.mint, account.address),
    ).toThrow('not captured');
    invalidateMockReadPortSession(session);
    expect(() => selectSolanaSourceTokenAccount(view, account.mint, account.address)).toThrow(
      'stale',
    );
  });
});
