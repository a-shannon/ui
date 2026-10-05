import { SOLANA_SYSTEM_PROGRAM_ID } from '@rosen-network/solana';

import type { SolanaWalletSession } from '../src/eventBoundWalletPort';
import type { SolanaLockFeeIntent } from '../src/feeQuote';
import { feeQuoteTestData as data } from './feeQuoteTestData';
import { mockFeeQuoteProducers, mockFeeQuoteSession } from './mocked/feeQuote.mock';
import { createReadPortProfile, createReadPortResult } from './readPortTestUtils';
import { ergoDestination, keypair, nativeProfile } from './testUtils';

/** Generates independent mutable service results and observable callbacks for one exact-message quote. */
export const createFeeQuoteFixture = (
  kind: 'native' | 'spl' = 'native',
  session: SolanaWalletSession = mockFeeQuoteSession(keypair(1).publicKey.toBase58()),
) => {
  const profile = kind === 'native' ? nativeProfile() : createReadPortProfile();
  const intent: SolanaLockFeeIntent = {
    asset: kind === 'native' ? 'SOL' : keypair(4).publicKey.toBase58(),
    grossAmount: data.grossAmount,
    destinationAddress: ergoDestination,
    ...(kind === 'spl' ? { sourceTokenAccount: keypair(6).publicKey.toBase58() } : {}),
  };
  const options = {
    minimumNativeRemainder: data.minimumNativeRemainder,
    minimumRemainingBlocks: data.minimumRemainingBlocks,
  };
  const base = { clusterGenesisHash: profile.clusterGenesisHash, commitment: 'finalized' as const };
  const balance = {
    ...createReadPortResult(session.publicKey),
    nativeBalance: data.nativeBalance,
    nativeContextSlot: 10n,
    tokenContextSlot: 10n,
  };
  const blockhash = {
    ...base,
    contextSlot: 11n,
    blockhash: keypair(9).publicKey.toBase58(),
    lastValidBlockHeight: data.lastValidBlockHeight,
  };
  const payer = {
    ...base,
    contextSlot: 12n,
    address: session.publicKey,
    owner: SOLANA_SYSTEM_PROGRAM_ID,
    executable: false,
    dataBase64: '',
    lamports: data.payerLamports,
  };
  const rent = { ...base, dataLength: 0, minimumLamports: data.rentMinimum };
  const fee = { ...base, contextSlot: 13n, feeLamports: data.feeLamports as bigint | null };
  const height = {
    clusterGenesisHash: profile.clusterGenesisHash,
    commitment: 'confirmed' as const,
    blockHeight: data.blockHeight,
  };
  const producers = mockFeeQuoteProducers({
    readBalance: async () => balance,
    readLatestBlockhash: async () => blockhash,
    readFeePayer: async () => payer,
    readRentMinimum: async () => rent,
    readMessageFee: async (request) => ({ ...fee, messageBase64: request.messageBase64 }),
    readBlockHeight: async () => height,
  });
  /** Advances all contextual results for revalidation without changing the original blockhash. */
  const advance = () => {
    balance.nativeContextSlot = 20n;
    balance.tokenContextSlot = 20n;
    payer.contextSlot = 21n;
    fee.contextSlot = 22n;
  };
  return {
    profile,
    session,
    intent,
    options,
    producers,
    balance,
    blockhash,
    payer,
    rent,
    fee,
    height,
    advance,
  };
};

/** Starts the public API with the exact fixture coordinates rather than an assembled view or build. */
export const feeQuoteArguments = (fixture: ReturnType<typeof createFeeQuoteFixture>) =>
  [fixture.profile, fixture.session, fixture.intent, fixture.producers, fixture.options] as const;

/** Creates a strict-result descriptor trap that can invalidate a session without invoking a getter. */
export const feeQuoteDescriptorTrap = (value: object, invalidate: () => void): object =>
  new Proxy(value, {
    ownKeys: (target) => {
      invalidate();
      return Reflect.ownKeys(target);
    },
  });
