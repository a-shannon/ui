import { Buffer } from 'buffer';

import { Transaction, type Transaction as WalletTransaction } from '@solana/web3.js';

import {
  captureSolanaLockProfile,
  parseJson,
  readU64Value,
  SOLANA_SPL_PROGRAM_ID,
  SOLANA_SYSTEM_PROGRAM_ID,
} from '@rosen-network/solana';

import {
  createEventBoundSolanaWalletPort,
  getSolanaLockFeeQuoteBuild,
  isCurrentSolanaLockFeeQuote,
  isCurrentSolanaSignedLock,
  prepareSolanaLockFeeQuote,
  revalidateSolanaSignedLock,
  type SolanaLockFeeProducers,
  type SolanaWalletConnectionEvent,
  signSolanaLockFeeQuote,
} from '../src/index';
import { ergoDestination, keypair } from './testUtils';

/** Fails a browser integration fixture at its named consumer invariant. */
const check = (value: unknown, label: string): void => {
  if (!value) throw new Error(label);
};

/** Requires the precise refusal while preserving all other synthetic fixture inputs. */
const rejects = async (action: () => Promise<unknown>, expected: string): Promise<void> => {
  let rejected = false;
  try {
    await action();
  } catch (error) {
    rejected = true;
    check(error instanceof Error && error.message === expected, `Wrong refusal: ${expected}`);
  }
  check(rejected, `Missing refusal: ${expected}`);
};

/** Creates one synthetic wallet, captured asset and monotonic raw service producer set. */
const fixture = async (spl: boolean) => {
  const signer = keypair(1);
  const address = signer.publicKey.toBase58();
  const mint = keypair(4).publicKey.toBase58();
  const account = keypair(6).publicKey.toBase58();
  const genesis = keypair(7).publicKey.toBase58();
  const listeners = new Map<SolanaWalletConnectionEvent, Set<() => void>>();
  let signingCalls = 0;
  let feeCalls = 0;
  let latestCalls = 0;
  const state = { fee: 7n as bigint | null, height: 190n, native: 9_007_199_254_740_995n };
  const provider = {
    publicKey: signer.publicKey,
    isConnected: false,
    connect: async () => {
      provider.isConnected = true;
      return { publicKey: provider.publicKey };
    },
    disconnect: async () => {
      provider.isConnected = false;
    },
    signTransaction: async (transaction: WalletTransaction) => {
      signingCalls += 1;
      transaction.partialSign(signer);
      return transaction;
    },
    on: (event: SolanaWalletConnectionEvent, listener: () => void) => {
      const group = listeners.get(event) ?? new Set<() => void>();
      group.add(listener);
      listeners.set(event, group);
    },
    off: (event: SolanaWalletConnectionEvent, listener: () => void) => {
      listeners.get(event)?.delete(listener);
    },
  };
  const port = createEventBoundSolanaWalletPort(() => provider);
  await port.connect();
  const asset = spl ? mint : 'SOL';
  const profile = captureSolanaLockProfile({
    clusterGenesisHash: genesis,
    destinationNetwork: 'mainnet',
    vaultOwner: keypair(41).publicKey.toBase58(),
    memoVersion: 1,
    assets: {
      [asset]: {
        kind: spl ? 'spl' : 'native',
        sourceDecimals: spl ? 6 : 9,
        destinationDecimals: spl ? 6 : 9,
        destinationTokenId: 'cd'.repeat(32),
        minimumGrossAmount: '1000',
        maximumGrossAmount: '10000000',
        networkFee: '100',
        bridgeFee: '200',
        ...(spl ? { vaultTokenAccount: keypair(5).publicKey.toBase58() } : {}),
      },
    },
  });
  const base = { clusterGenesisHash: genesis, commitment: 'finalized' as const };
  const producers: SolanaLockFeeProducers = {
    readBalance: async (request) => ({
      ...base,
      address,
      nativeContextSlot: request.minContextSlot + 1n,
      tokenContextSlot: request.minContextSlot + 1n,
      nativeBalance: state.native,
      tokenAccounts: spl
        ? [
            {
              address: account,
              mint,
              programId: SOLANA_SPL_PROGRAM_ID,
              owner: address,
              amount: 1500n,
              decimals: 6,
              state: 'initialized',
            },
          ]
        : [],
    }),
    readLatestBlockhash: async (request) => {
      latestCalls += 1;
      return {
        ...base,
        contextSlot: request.minContextSlot + 1n,
        blockhash: keypair(9).publicKey.toBase58(),
        lastValidBlockHeight: 200n,
      };
    },
    readFeePayer: async (request) => ({
      ...base,
      contextSlot: request.minContextSlot + 1n,
      address,
      owner: SOLANA_SYSTEM_PROGRAM_ID,
      executable: false,
      dataBase64: '',
      lamports: state.native - 2n,
    }),
    readRentMinimum: async () => ({ ...base, dataLength: 0, minimumLamports: 11n }),
    readMessageFee: async (request) => {
      feeCalls += 1;
      return {
        ...base,
        contextSlot: request.minContextSlot + 1n,
        messageBase64: request.messageBase64,
        feeLamports: state.fee,
      };
    },
    readBlockHeight: async () => ({
      clusterGenesisHash: genesis,
      commitment: 'confirmed',
      blockHeight: state.height,
    }),
  };
  const quote = await prepareSolanaLockFeeQuote(
    profile,
    port.captureSession(),
    {
      asset,
      grossAmount: '1000',
      destinationAddress: ergoDestination,
      ...(spl ? { sourceTokenAccount: account } : {}),
    },
    producers,
    { minimumNativeRemainder: 5n, minimumRemainingBlocks: 1n },
  );
  return {
    quote,
    port,
    provider,
    state,
    signingCalls: () => signingCalls,
    feeCalls: () => feeCalls,
    latestCalls: () => latestCalls,
    emit: (event: SolanaWalletConnectionEvent) => {
      for (const callback of Array.from(listeners.get(event) ?? [])) callback();
    },
  };
};

/** Exercises compiled quote/signing and numeric parsing in a browser realm without Node globals. */
export const runBrowserFeeQuoteChecks = async () => {
  let checks = 0;
  /** Records one independently checked browser consumer outcome. */
  const assert = (value: unknown, label: string) => {
    check(value, label);
    checks += 1;
  };
  for (const spl of [false, true]) {
    const f = await fixture(spl);
    try {
      const copy = getSolanaLockFeeQuoteBuild(f.quote);
      copy.transaction.recentBlockhash = keypair(12).publicKey.toBase58();
      assert(isCurrentSolanaLockFeeQuote(f.quote), 'Copy mutation changed private quote');
      const signed = await signSolanaLockFeeQuote(f.quote, f.port);
      const transaction = Transaction.from(Buffer.from(signed.wireBase64, 'base64'));
      assert(transaction.verifySignatures(), 'Installed signature differs');
      assert(
        Buffer.from(transaction.serializeMessage()).toString('base64') ===
          signed.quote.messageBase64,
        'Installed signed message differs from quote',
      );
      assert(signed.quote.nativeAvailable === 9_007_199_254_740_993n, 'Wide payer balance changed');
      assert(
        f.feeCalls() === 3 && f.latestCalls() === 1 && f.signingCalls() === 1,
        'Missing pre/post validation or repeated signing',
      );
      assert(!isCurrentSolanaSignedLock({ ...signed }), 'Copied wire handle gained provenance');
      const successor = await revalidateSolanaSignedLock(signed);
      assert(
        successor.wireBase64 === signed.wireBase64 && f.signingCalls() === 1,
        'Fresh reread changed wire or signed again',
      );
      assert(
        !isCurrentSolanaSignedLock(signed) && isCurrentSolanaSignedLock(successor),
        'Signed predecessor remained current',
      );
      f.emit('accountChanged');
      assert(!isCurrentSolanaSignedLock(successor), 'Event left signed quote current');
    } finally {
      f.port.dispose();
    }
  }
  const unavailable = await fixture(false);
  try {
    unavailable.state.fee = null;
    await rejects(
      () => signSolanaLockFeeQuote(unavailable.quote, unavailable.port),
      'Message fee is unavailable',
    );
    assert(unavailable.signingCalls() === 0, 'Unavailable fee invoked wallet');
  } finally {
    unavailable.port.dispose();
  }
  const expired = await fixture(false);
  try {
    const sign = expired.provider.signTransaction;
    expired.provider.signTransaction = async (transaction) => {
      const result = await sign(transaction);
      expired.state.height = 201n;
      return result;
    };
    await rejects(
      () => signSolanaLockFeeQuote(expired.quote, expired.port),
      'Solana quote blockhash expired',
    );
    assert(expired.signingCalls() === 1, 'Missing after-wallet expiry check');
  } finally {
    expired.port.dispose();
  }
  assert(
    readU64Value(parseJson('9007199254740993')) === 9_007_199_254_740_993n,
    'Browser parser rounded an integer',
  );
  const globals = globalThis as unknown as Record<string, unknown>;
  return {
    checks,
    absentGlobals: {
      Buffer: typeof globals.Buffer,
      process: typeof globals.process,
      require: typeof globals.require,
    },
  };
};
