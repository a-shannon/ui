import { Buffer } from 'buffer';

import type { Transaction } from '@solana/web3.js';
import { vi } from 'vitest';

import type { SolanaLockBuild } from '@rosen-network/solana';

import type { SolanaLockFeeQuote } from '../../src/feeQuote';
import type { SolanaSignerPort } from '../../src/signerPort';

let activeQuotes = new WeakSet<object>();

/** Fully mocks fee and signing dependencies; unit tests execute only the quoted-signing module. */
export const quotedSignerMocks = {
  revalidateSolanaLockFeeQuote: vi.fn<(quote: SolanaLockFeeQuote) => Promise<SolanaLockFeeQuote>>(),
  getSolanaLockFeeQuoteBuild: vi.fn<(quote: SolanaLockFeeQuote) => SolanaLockBuild>(),
  isCurrentSolanaLockFeeQuote: vi.fn<(value: unknown) => boolean>(),
  signSolanaLockTransaction:
    vi.fn<(build: SolanaLockBuild, port: SolanaSignerPort) => Promise<Transaction>>(),
};

/** Produces an immutable locally branded unit quote with deliberately non-transaction message bytes. */
export const mockQuotedSignerQuote = (): SolanaLockFeeQuote => {
  const quote = Object.freeze({
    messageBase64: 'AQID',
    blockhash: 'unit-blockhash',
    lastValidBlockHeight: 200n,
    blockHeight: 190n,
    contextSlot: 13n,
    feeLamports: 7n,
    nativeAvailable: 1900n,
    nativeReserve: 11n,
    sourceQuantum: 1n,
    indicativeMaximumGrossAmount: 1882n,
  });
  activeQuotes.add(quote);
  return quote;
};

/** Implements only the mocked quote connector's branding/currentness contract. */
export const mockIsCurrentQuotedSignerQuote = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && activeQuotes.has(value);

/** Retires a mocked quote without exposing the unit state registry. */
export const retireMockQuotedSignerQuote = (quote: SolanaLockFeeQuote): void => {
  activeQuotes.delete(quote);
};

/** Resets the fully mocked module boundaries and supplies one independent SDK-method stub. */
export const mockQuotedSignerFixture = () => {
  activeQuotes = new WeakSet<object>();
  for (const mock of Object.values(quotedSignerMocks)) mock.mockReset();
  const quote = mockQuotedSignerQuote();
  const transaction = {
    serializeMessage: vi.fn(() => Buffer.from(quote.messageBase64, 'base64')),
    serialize: vi.fn((): Uint8Array => Uint8Array.from([4, 5, 6])),
  };
  // The verified signer is fully mocked; no fake SDK instance reaches a real signer or wallet.
  const sdkTransaction = transaction as unknown as Transaction;
  const build: SolanaLockBuild = Object.freeze({
    transaction: sdkTransaction,
    sourceAuthority: 'unit-authority',
    asset: 'SOL',
    grossAmount: '1000',
    memo: 'unit-memo',
  });
  const port: SolanaSignerPort = {
    getPublicKey: vi.fn(() => null),
    signTransaction: vi.fn(async () => sdkTransaction),
  };
  quotedSignerMocks.isCurrentSolanaLockFeeQuote.mockImplementation(mockIsCurrentQuotedSignerQuote);
  quotedSignerMocks.revalidateSolanaLockFeeQuote.mockImplementation(async (old) => {
    if (!mockIsCurrentQuotedSignerQuote(old)) throw new Error('mock quote stale');
    retireMockQuotedSignerQuote(old);
    return mockQuotedSignerQuote();
  });
  quotedSignerMocks.getSolanaLockFeeQuoteBuild.mockReturnValue(build);
  quotedSignerMocks.signSolanaLockTransaction.mockResolvedValue(sdkTransaction);
  return { quote, transaction, build, port };
};
