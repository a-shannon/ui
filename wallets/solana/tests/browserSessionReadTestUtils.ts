import { Keypair, type Transaction } from '@solana/web3.js';

import { captureSolanaLockProfile, SOLANA_SPL_PROGRAM_ID } from '@rosen-network/solana';

import {
  createEventBoundSolanaWalletPort,
  isCurrentSolanaWalletBalanceView,
  isCurrentSolanaWalletSession,
  readSolanaWalletBalance,
  selectSolanaSourceTokenAccount,
} from '../src/index';

/** Generates a deterministic fixture key without external wallet material. */
const key = (seed: number) =>
  Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => seed + index));

/** Captures an original-SPL policy for synthetic session and balance checks. */
const profile = () =>
  captureSolanaLockProfile({
    clusterGenesisHash: key(7).publicKey.toBase58(),
    destinationNetwork: 'mainnet',
    vaultOwner: key(41).publicKey.toBase58(),
    memoVersion: 1,
    assets: {
      [key(4).publicKey.toBase58()]: {
        kind: 'spl',
        sourceDecimals: 6,
        destinationDecimals: 6,
        destinationTokenId: 'cd'.repeat(32),
        minimumGrossAmount: '1000',
        maximumGrossAmount: '10000000',
        networkFee: '100',
        bridgeFee: '200',
        vaultTokenAccount: key(5).publicKey.toBase58(),
      },
    },
  });

/** Creates one event-capable synthetic provider and its actual session adapter. */
const fixture = () => {
  const signer = key(1);
  const listeners = new Map<string, Set<() => void>>();
  let connections = 0;
  const provider = {
    publicKey: signer.publicKey,
    isConnected: false,
    connect: async () => {
      connections += 1;
      provider.isConnected = true;
      return { publicKey: provider.publicKey };
    },
    disconnect: async () => {
      provider.isConnected = false;
    },
    signTransaction: async (transaction: Transaction) => {
      transaction.partialSign(signer);
      return transaction;
    },
    on: (event: string, listener: () => void) => {
      const group = listeners.get(event) ?? new Set<() => void>();
      group.add(listener);
      listeners.set(event, group);
    },
    off: (event: string, listener: () => void) => {
      listeners.get(event)?.delete(listener);
    },
  };
  const port = createEventBoundSolanaWalletPort(() => provider);
  /** Emits only through the currently registered owned handlers. */
  const emit = (event: string) => {
    for (const listener of Array.from(listeners.get(event) ?? [])) listener();
  };
  return { provider, port, emit, connections: () => connections };
};

/** Returns raw odd bigint balances and two separately named original-SPL accounts. */
const result = () => ({
  address: key(1).publicKey.toBase58(),
  clusterGenesisHash: key(7).publicKey.toBase58(),
  commitment: 'finalized',
  nativeContextSlot: 42n,
  tokenContextSlot: 42n,
  nativeBalance: 9007199254740993n,
  tokenAccounts: [
    {
      address: key(6).publicKey.toBase58(),
      mint: key(4).publicKey.toBase58(),
      programId: SOLANA_SPL_PROGRAM_ID,
      owner: key(1).publicKey.toBase58(),
      amount: 9007199254740995n,
      decimals: 6,
      state: 'initialized',
    },
    {
      address: key(9).publicKey.toBase58(),
      mint: key(4).publicKey.toBase58(),
      programId: SOLANA_SPL_PROGRAM_ID,
      owner: key(1).publicKey.toBase58(),
      amount: 2n,
      decimals: 6,
      state: 'initialized',
    },
  ],
});

/** Exercises public session/read exports with no Node globals, wallet extension or RPC. */
export const runBrowserSessionReadChecks = async () => {
  const checks: string[] = [];
  /** Retains the label of each exact consumer assertion. */
  const check = (condition: unknown, label: string) => {
    if (!condition) throw new Error(label);
    checks.push(label);
  };
  /** Requires the expected failure instead of counting an unrelated exception. */
  const rejects = async (action: () => unknown, expected: string, label: string) => {
    let failure: unknown;
    try {
      await action();
    } catch (error) {
      failure = error;
    }
    check(failure instanceof Error && failure.message.includes(expected), label);
  };

  const first = fixture();
  await first.port.connect();
  const session = first.port.captureSession();
  const capturedProfile = profile();
  let producerCalls = 0;
  /** Checks the captured request before returning independent synthetic service data. */
  const producer = async (request: {
    address: string;
    clusterGenesisHash: string;
    commitment: string;
  }) => {
    producerCalls += 1;
    check(
      request.address === session.publicKey &&
        request.clusterGenesisHash === capturedProfile.clusterGenesisHash &&
        request.commitment === 'finalized' &&
        Object.isFrozen(request),
      'exact frozen read request',
    );
    return result();
  };
  const view = await readSolanaWalletBalance(capturedProfile, session, producer);
  check(view.nativeBalance === 9007199254740993n, 'native bigint above Number precision');
  check(view.tokenAccounts[0].amount === 9007199254740995n, 'SPL bigint above Number precision');
  check(isCurrentSolanaWalletBalanceView(view), 'original view locally current');
  check(
    Object.isFrozen(view) &&
      Object.isFrozen(view.tokenAccounts) &&
      view.tokenAccounts.every(Object.isFrozen),
    'immutable installed view',
  );
  check(
    selectSolanaSourceTokenAccount(view, key(4).publicKey.toBase58(), key(9).publicKey.toBase58())
      .amount === 2n,
    'explicit small SPL account without aggregation',
  );
  check(!isCurrentSolanaWalletSession({ ...session }), 'copied session lacks provenance');
  const before = producerCalls;
  await rejects(
    () => readSolanaWalletBalance(capturedProfile, { ...session }, producer),
    'stale',
    'copied session read refused',
  );
  check(producerCalls === before, 'copied session refused before producer');
  check(!isCurrentSolanaWalletBalanceView({ ...view }), 'copied view lacks provenance');
  await rejects(
    () =>
      selectSolanaSourceTokenAccount(
        { ...view },
        key(4).publicKey.toBase58(),
        key(6).publicKey.toBase58(),
      ),
    'not captured',
    'copied view selection refused',
  );
  first.port.dispose();

  const second = fixture();
  await second.port.connect();
  const oldSession = second.port.captureSession();
  const oldView = await readSolanaWalletBalance(profile(), oldSession, async () => result());
  let resolve!: (value: unknown) => void;
  const deferred = new Promise<unknown>((complete) => {
    resolve = complete;
  });
  const pending = readSolanaWalletBalance(profile(), oldSession, () => deferred);
  second.emit('accountChanged');
  check(!isCurrentSolanaWalletBalanceView(oldView), 'event revokes existing view');
  await rejects(
    () =>
      selectSolanaSourceTokenAccount(
        oldView,
        key(4).publicKey.toBase58(),
        key(6).publicKey.toBase58(),
      ),
    'stale',
    'event revokes source selection',
  );
  resolve(result());
  await rejects(() => pending, 'stale', 'event revokes pending read');
  check(second.connections() === 1, 'event does not reconnect provider');
  second.port.dispose();

  const third = fixture();
  await third.port.connect();
  const captured = third.port.captureSession();
  const previousView = await readSolanaWalletBalance(profile(), captured, async () => result());
  const originalKey = third.provider.publicKey;
  third.provider.publicKey = key(2).publicKey;
  check(
    !isCurrentSolanaWalletSession(captured),
    'valid canonical account mismatch revokes capture',
  );
  third.provider.publicKey = originalKey;
  check(
    !isCurrentSolanaWalletSession(captured) && !isCurrentSolanaWalletBalanceView(previousView),
    'restored key does not revive old capture or view',
  );
  check(third.port.getPublicKey() === null, 'restored key remains disconnected');
  await rejects(
    () => third.port.captureSession(),
    'disconnected',
    'restored key needs explicit reconnect',
  );
  await third.port.connect();
  check(
    !isCurrentSolanaWalletSession(captured) &&
      isCurrentSolanaWalletSession(third.port.captureSession()),
    'reconnect grants only new capture',
  );
  third.port.dispose();

  const fourth = fixture();
  await fourth.port.connect();
  const nativeSession = fourth.port.captureSession();
  await rejects(
    () =>
      readSolanaWalletBalance(profile(), nativeSession, async () => ({
        ...result(),
        address: key(2).publicKey.toBase58(),
        tokenAccounts: [],
      })),
    'address differs',
    'native-only wrong canonical address refused',
  );
  fourth.port.dispose();
  return {
    checks,
    checkCount: checks.length,
    rawNative: view.nativeBalance.toString(),
    rawSPL: view.tokenAccounts[0].amount.toString(),
    selectedSPL: '2',
    absentGlobals: {
      Buffer: typeof globalThis.Buffer,
      process: typeof globalThis.process,
      require: typeof globalThis.require,
    },
  };
};
