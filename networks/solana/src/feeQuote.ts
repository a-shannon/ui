import { Buffer } from 'buffer';

import { PublicKey } from '@solana/web3.js';

import {
  buildSolanaLockMessage,
  getSolanaLockBuildEvidence,
  hasCapturedSolanaLockMessage,
  type SolanaLockBuild,
} from './buildLockMessage';
import {
  ERGO_SIGNED_AMOUNT_MAX,
  isCapturedSolanaLockProfile,
  SOLANA_SYSTEM_PROGRAM_ID,
  SOLANA_U64_MAX,
  type SolanaLockProfile,
} from './lockProfile';
import {
  readSolanaWalletBalance,
  type SolanaWalletReadRequest,
  selectSolanaSourceTokenAccount,
} from './readPort';
import type { SolanaWalletSession, SolanaWalletSessionCurrentness } from './walletSession';

export interface SolanaLockFeeIntent {
  readonly asset: string;
  readonly grossAmount: string;
  readonly destinationAddress: string;
  readonly sourceTokenAccount?: string;
}

export interface SolanaLockFeeOptions {
  readonly minimumNativeRemainder: bigint;
  readonly minimumRemainingBlocks: bigint;
}

export interface SolanaFeeContextRequest {
  readonly clusterGenesisHash: string;
  readonly commitment: 'finalized';
  readonly minContextSlot: bigint;
}

/** Raw service contracts; no SDK number result or RPC JSON is parsed here. */
export interface SolanaLockFeeProducers {
  readonly readBalance: (
    request: SolanaWalletReadRequest & { readonly minContextSlot: bigint },
  ) => Promise<unknown>;
  readonly readLatestBlockhash: (request: SolanaFeeContextRequest) => Promise<unknown>;
  readonly readFeePayer: (
    request: SolanaFeeContextRequest & { readonly address: string },
  ) => Promise<unknown>;
  readonly readRentMinimum: (request: {
    readonly clusterGenesisHash: string;
    readonly commitment: 'finalized';
    readonly dataLength: 0;
  }) => Promise<unknown>;
  readonly readMessageFee: (
    request: SolanaFeeContextRequest & { readonly messageBase64: string },
  ) => Promise<unknown>;
  readonly readBlockHeight: (request: {
    readonly clusterGenesisHash: string;
    readonly commitment: 'confirmed';
    readonly minContextSlot: bigint;
  }) => Promise<unknown>;
}

/**
 * A budget for these exact message bytes, based on unauthenticated service assertions.
 * The indicative maximum requires a new message and quote if the gross amount changes.
 */
export interface SolanaLockFeeQuote {
  readonly messageBase64: string;
  readonly blockhash: string;
  readonly lastValidBlockHeight: bigint;
  readonly blockHeight: bigint;
  readonly contextSlot: bigint;
  readonly feeLamports: bigint;
  readonly nativeAvailable: bigint;
  readonly nativeReserve: bigint;
  readonly sourceQuantum: bigint;
  readonly indicativeMaximumGrossAmount: bigint;
}

interface QuoteEvidence {
  readonly profile: SolanaLockProfile;
  readonly session: SolanaWalletSession;
  readonly isCurrentSession: SolanaWalletSessionCurrentness;
  readonly intent: SolanaLockFeeIntent;
  readonly options: SolanaLockFeeOptions;
  readonly producers: SolanaLockFeeProducers;
  readonly build: SolanaLockBuild;
  readonly messageBase64: string;
  readonly blockhash: string;
  readonly lastValidBlockHeight: bigint;
  active: boolean;
}

const quotes = new WeakMap<SolanaLockFeeQuote, QuoteEvidence>();

/** Copies only own data fields of ordinary records without invoking getters. */
const ownRecord = (value: unknown, fields: readonly string[], label: string) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError(`Invalid ${label}`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError(`Invalid ${label} prototype`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key as string)))
    throw new TypeError(`Unexpected or missing ${label} fields`);
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !Object.hasOwn(descriptor, 'value'))
      throw new TypeError(`Invalid ${label} accessor`);
    result[field] = descriptor.value;
  }
  return result;
};

/** Requires exact service integers without coercion or floating point. */
const u64 = (value: unknown, label: string): bigint => {
  if (typeof value !== 'bigint') throw new TypeError(`Invalid raw ${label}`);
  if (value < 0n || value > SOLANA_U64_MAX) throw new RangeError(`Invalid raw ${label} range`);
  return value;
};

/** Requires canonical base58 keys and blockhashes. */
const key = (value: unknown, label: string): string => {
  if (typeof value !== 'string') throw new TypeError(`Invalid ${label}`);
  try {
    if (new PublicKey(value).toBase58() !== value) throw new Error('noncanonical');
    return value;
  } catch {
    throw new TypeError(`Invalid ${label}`);
  }
};

/** Checks captured authority and optional exact message after all external boundaries. */
const requireInputs = (
  profile: SolanaLockProfile,
  session: SolanaWalletSession,
  build: SolanaLockBuild | undefined,
  isCurrentSession: SolanaWalletSessionCurrentness,
): void => {
  if (!isCapturedSolanaLockProfile(profile))
    throw new TypeError('Solana lock profile was not captured');
  if (!isCurrentSession(session)) throw new Error('Solana wallet session is stale');
  if (build && !hasCapturedSolanaLockMessage(build))
    throw new Error('Solana quote message changed');
  if (build && !isCurrentSession(session)) throw new Error('Solana wallet session is stale');
};

/** Captures an exact immutable intent before the first producer await. */
const captureIntent = (value: SolanaLockFeeIntent): SolanaLockFeeIntent => {
  const optional =
    typeof value === 'object' && value !== null && Object.hasOwn(value, 'sourceTokenAccount');
  const record = ownRecord(
    value,
    ['asset', 'grossAmount', 'destinationAddress', ...(optional ? ['sourceTokenAccount'] : [])],
    'fee intent',
  );
  if (typeof record.asset !== 'string') throw new TypeError('Invalid fee intent asset');
  if (typeof record.destinationAddress !== 'string')
    throw new TypeError('Invalid fee intent destination');
  if (typeof record.grossAmount !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(record.grossAmount))
    throw new TypeError('Invalid fee intent gross amount');
  u64(BigInt(record.grossAmount), 'gross amount');
  return Object.freeze({
    asset: record.asset,
    grossAmount: record.grossAmount,
    destinationAddress: record.destinationAddress,
    ...(optional
      ? { sourceTokenAccount: key(record.sourceTokenAccount, 'source token account') }
      : {}),
  });
};

/** Captures required explicit reserve and expiry policy, with no production defaults. */
const captureOptions = (value: SolanaLockFeeOptions): SolanaLockFeeOptions => {
  const record = ownRecord(
    value,
    ['minimumNativeRemainder', 'minimumRemainingBlocks'],
    'fee options',
  );
  return Object.freeze({
    minimumNativeRemainder: u64(record.minimumNativeRemainder, 'minimum native remainder'),
    minimumRemainingBlocks: u64(record.minimumRemainingBlocks, 'minimum remaining blocks'),
  });
};

/** Snapshots each callback once and refuses accessor or inherited producers. */
const captureProducers = (value: SolanaLockFeeProducers): SolanaLockFeeProducers => {
  const fields = [
    'readBalance',
    'readLatestBlockhash',
    'readFeePayer',
    'readRentMinimum',
    'readMessageFee',
    'readBlockHeight',
  ];
  const record = ownRecord(value, fields, 'fee producers');
  for (const field of fields)
    if (typeof record[field] !== 'function') throw new TypeError(`Invalid fee producer ${field}`);
  return Object.freeze(record) as unknown as SolanaLockFeeProducers;
};

/** Performs fresh reads with monotonic slot floors and publishes one locally branded quote. */
const readQuote = async (
  profile: SolanaLockProfile,
  session: SolanaWalletSession,
  intent: SolanaLockFeeIntent,
  options: SolanaLockFeeOptions,
  producers: SolanaLockFeeProducers,
  initialFloor: bigint,
  isCurrentSession: SolanaWalletSessionCurrentness,
  previous?: QuoteEvidence,
): Promise<SolanaLockFeeQuote> => {
  let floor = initialFloor;
  let build = previous?.build;
  /** Gates current authority and the original compiled message across producer boundaries. */
  const guard = () => requireInputs(profile, session, build, isCurrentSession);
  /** Creates the current supported contextual request with immutable primitive fields. */
  const context = (): SolanaFeeContextRequest =>
    Object.freeze({
      clusterGenesisHash: profile.clusterGenesisHash,
      commitment: 'finalized',
      minContextSlot: floor,
    });
  /** Captures a reply and rechecks authority after descriptor traps or producer completion. */
  const reply = (
    value: unknown,
    fields: readonly string[],
    label: string,
    commitment = 'finalized',
  ) => {
    guard();
    const record = ownRecord(value, fields, label);
    guard();
    if (key(record.clusterGenesisHash, `${label} genesis`) !== profile.clusterGenesisHash)
      throw new TypeError(`${label} genesis differs from profile`);
    if (record.commitment !== commitment) throw new TypeError(`Invalid ${label} commitment`);
    return record;
  };
  /** Rejects stale context responses instead of inventing retries or atomicity. */
  const advance = (value: unknown, label: string) => {
    const slot = u64(value, `${label} context slot`);
    if (slot < floor) throw new RangeError(`${label} context is below requested floor`);
    floor = slot;
  };
  guard();
  const view = await readSolanaWalletBalance(
    profile,
    session,
    async (request) => {
      guard();
      const response = await producers.readBalance(
        Object.freeze({ ...request, minContextSlot: floor }),
      );
      guard();
      return response;
    },
    isCurrentSession,
  );
  guard();
  advance(view.contextSlot, 'balance');
  let blockhash = previous?.blockhash;
  let lastValidBlockHeight = previous?.lastValidBlockHeight;
  if (!previous) {
    const hash = reply(
      await producers.readLatestBlockhash(context()),
      ['clusterGenesisHash', 'commitment', 'contextSlot', 'blockhash', 'lastValidBlockHeight'],
      'blockhash',
    );
    advance(hash.contextSlot, 'blockhash');
    blockhash = key(hash.blockhash, 'blockhash');
    lastValidBlockHeight = u64(hash.lastValidBlockHeight, 'last valid block height');
    build = buildSolanaLockMessage(profile, {
      ...intent,
      senderAddress: session.publicKey,
      recentBlockhash: blockhash,
    });
    guard();
  }
  if (!build || blockhash === undefined || lastValidBlockHeight === undefined)
    throw new Error('Missing captured quote build');
  const evidence = getSolanaLockBuildEvidence(build);
  if (!evidence) throw new Error('Missing captured quote message');
  const messageBase64 = Buffer.from(evidence.messageBytes).toString('base64');
  const payer = reply(
    await producers.readFeePayer(Object.freeze({ ...context(), address: session.publicKey })),
    [
      'clusterGenesisHash',
      'commitment',
      'contextSlot',
      'address',
      'owner',
      'executable',
      'dataBase64',
      'lamports',
    ],
    'fee payer',
  );
  advance(payer.contextSlot, 'fee payer');
  if (key(payer.address, 'fee payer address') !== session.publicKey)
    throw new TypeError('Fee payer address differs from wallet session');
  if (key(payer.owner, 'fee payer owner') !== SOLANA_SYSTEM_PROGRAM_ID)
    throw new TypeError('Fee payer must be owned by System Program');
  if (payer.executable !== false) throw new TypeError('Fee payer must not be executable');
  if (payer.dataBase64 !== '') throw new TypeError('Fee payer data must be empty');
  const lamports = u64(payer.lamports, 'fee payer lamports');
  const rent = reply(
    await producers.readRentMinimum(
      Object.freeze({
        clusterGenesisHash: profile.clusterGenesisHash,
        commitment: 'finalized',
        dataLength: 0,
      }),
    ),
    ['clusterGenesisHash', 'commitment', 'dataLength', 'minimumLamports'],
    'rent minimum',
  );
  if (rent.dataLength !== 0) throw new TypeError('Rent minimum must describe zero data');
  const rentMinimum = u64(rent.minimumLamports, 'rent minimum');
  const fee = reply(
    await producers.readMessageFee(Object.freeze({ ...context(), messageBase64 })),
    ['clusterGenesisHash', 'commitment', 'contextSlot', 'messageBase64', 'feeLamports'],
    'message fee',
  );
  advance(fee.contextSlot, 'message fee');
  if (fee.messageBase64 !== messageBase64)
    throw new TypeError('Message fee differs from captured message');
  if (fee.feeLamports === null) throw new Error('Message fee is unavailable');
  const feeLamports = u64(fee.feeLamports, 'message fee');
  const height = reply(
    await producers.readBlockHeight(
      Object.freeze({
        clusterGenesisHash: profile.clusterGenesisHash,
        commitment: 'confirmed',
        minContextSlot: floor,
      }),
    ),
    ['clusterGenesisHash', 'commitment', 'blockHeight'],
    'block height',
    'confirmed',
  );
  const blockHeight = u64(height.blockHeight, 'block height');
  if (blockHeight > lastValidBlockHeight) throw new RangeError('Solana quote blockhash expired');
  if (lastValidBlockHeight - blockHeight < options.minimumRemainingBlocks)
    throw new RangeError('Solana quote has insufficient remaining blocks');
  const nativeAvailable = view.nativeBalance < lamports ? view.nativeBalance : lamports;
  const nativeReserve =
    options.minimumNativeRemainder > rentMinimum ? options.minimumNativeRemainder : rentMinimum;
  if (feeLamports + nativeReserve > nativeAvailable)
    throw new RangeError('Insufficient native fee and reserve balance');
  const policy = profile.assets[intent.asset];
  if (!policy) throw new TypeError('Asset is not in captured allowlist');
  const gross = BigInt(intent.grossAmount);
  const nativeBudget = nativeAvailable - feeLamports - nativeReserve;
  let sourceBudget = nativeBudget;
  if (policy.kind === 'spl') {
    if (!intent.sourceTokenAccount) throw new TypeError('Missing selected SPL account');
    const selected = selectSolanaSourceTokenAccount(view, intent.asset, intent.sourceTokenAccount);
    sourceBudget = selected.amount;
    if (gross > sourceBudget) throw new RangeError('Insufficient selected SPL account balance');
  } else if (gross > sourceBudget) throw new RangeError('Insufficient native gross balance');
  const delta = policy.destinationDecimals - policy.sourceDecimals;
  const sourceQuantum = delta < 0 ? 10n ** BigInt(-delta) : 1n;
  const ergoMaximum = delta >= 0 ? ERGO_SIGNED_AMOUNT_MAX / 10n ** BigInt(delta) : SOLANA_U64_MAX;
  const maximum = [sourceBudget, BigInt(policy.maximumGrossAmount), ergoMaximum].reduce((a, b) =>
    a < b ? a : b,
  );
  const indicativeMaximumGrossAmount = maximum - (maximum % sourceQuantum);
  if (indicativeMaximumGrossAmount < BigInt(policy.minimumGrossAmount))
    throw new RangeError('Indicative maximum is below captured minimum');
  guard();
  const quote = Object.freeze({
    messageBase64,
    blockhash,
    lastValidBlockHeight,
    blockHeight,
    contextSlot: floor,
    feeLamports,
    nativeAvailable,
    nativeReserve,
    sourceQuantum,
    indicativeMaximumGrossAmount,
  });
  quotes.set(quote, {
    profile,
    session,
    isCurrentSession,
    intent,
    options,
    producers,
    build,
    messageBase64,
    blockhash,
    lastValidBlockHeight,
    active: true,
  });
  return quote;
};

/** Captures intent and policy before creating a fresh balance, blockhash and exact-message quote. */
const prepareWithCurrentness = async (
  profile: SolanaLockProfile,
  session: SolanaWalletSession,
  intent: SolanaLockFeeIntent,
  producers: SolanaLockFeeProducers,
  options: SolanaLockFeeOptions,
  isCurrentSession: SolanaWalletSessionCurrentness,
): Promise<SolanaLockFeeQuote> => {
  requireInputs(profile, session, undefined, isCurrentSession);
  const capturedIntent = captureIntent(intent);
  requireInputs(profile, session, undefined, isCurrentSession);
  const capturedProducers = captureProducers(producers);
  requireInputs(profile, session, undefined, isCurrentSession);
  const capturedOptions = captureOptions(options);
  requireInputs(profile, session, undefined, isCurrentSession);
  return readQuote(
    profile,
    session,
    capturedIntent,
    capturedOptions,
    capturedProducers,
    0n,
    isCurrentSession,
  );
};

export interface SolanaLockFeeQuoteService {
  readonly prepare: (
    profile: SolanaLockProfile,
    session: SolanaWalletSession,
    intent: SolanaLockFeeIntent,
    producers: SolanaLockFeeProducers,
    options: SolanaLockFeeOptions,
  ) => Promise<SolanaLockFeeQuote>;
  readonly isCurrent: (quote: unknown) => quote is SolanaLockFeeQuote;
  readonly getBuild: (quote: SolanaLockFeeQuote) => SolanaLockBuild;
  readonly revalidate: (quote: SolanaLockFeeQuote) => Promise<SolanaLockFeeQuote>;
}

/** Captures one wallet-port authority for this network instance and all its evidence. */
export const createSolanaLockFeeQuoteService = (
  isCurrentSession: SolanaWalletSessionCurrentness,
): SolanaLockFeeQuoteService => {
  if (typeof isCurrentSession !== 'function') throw new TypeError('Invalid wallet session check');
  const currentness = isCurrentSession;
  return Object.freeze({
    prepare: (
      profile: SolanaLockProfile,
      session: SolanaWalletSession,
      intent: SolanaLockFeeIntent,
      producers: SolanaLockFeeProducers,
      options: SolanaLockFeeOptions,
    ) => prepareWithCurrentness(profile, session, intent, producers, options, currentness),
    isCurrent: (value: unknown): value is SolanaLockFeeQuote => {
      if (typeof value !== 'object' || value === null) return false;
      const evidence = quotes.get(value as SolanaLockFeeQuote);
      if (!evidence?.active || evidence.isCurrentSession !== currentness) return false;
      try {
        requireInputs(evidence.profile, evidence.session, evidence.build, currentness);
        return evidence.active;
      } catch {
        return false;
      }
    },
    getBuild: (quote: SolanaLockFeeQuote) => buildFromQuote(quote, currentness),
    revalidate: (quote: SolanaLockFeeQuote) => revalidateWithCurrentness(quote, currentness),
  });
};

/** Checks local branding and the validator captured with this quote's network instance. */
const isCurrentQuote = (
  value: unknown,
  requiredCurrentness: SolanaWalletSessionCurrentness,
): value is SolanaLockFeeQuote => {
  if (typeof value !== 'object' || value === null) return false;
  const evidence = quotes.get(value as SolanaLockFeeQuote);
  if (!evidence?.active || evidence.isCurrentSession !== requiredCurrentness) return false;
  try {
    requireInputs(evidence.profile, evidence.session, evidence.build, evidence.isCurrentSession);
    return evidence.active;
  } catch {
    return false;
  }
};

/** Rebuilds an independent transaction from captured primitives; the private original never leaves quote custody. */
const buildFromQuote = (
  quote: SolanaLockFeeQuote,
  isCurrentSession: SolanaWalletSessionCurrentness,
): SolanaLockBuild => {
  if (!isCurrentQuote(quote, isCurrentSession))
    throw new Error('Solana fee quote is stale or not captured');
  const evidence = quotes.get(quote);
  if (!evidence) throw new Error('Solana fee quote was not captured');
  const build = buildSolanaLockMessage(evidence.profile, {
    ...evidence.intent,
    senderAddress: evidence.session.publicKey,
    recentBlockhash: evidence.blockhash,
  });
  const captured = getSolanaLockBuildEvidence(build);
  if (!captured || Buffer.from(captured.messageBytes).toString('base64') !== evidence.messageBase64)
    throw new Error('Rebuilt lock differs from captured quote message');
  return build;
};

/** Retires the old quote before all external reads; failure cannot restore its local validity. */
const revalidateWithCurrentness = async (
  quote: SolanaLockFeeQuote,
  requiredCurrentness: SolanaWalletSessionCurrentness,
): Promise<SolanaLockFeeQuote> => {
  if (!isCurrentQuote(quote, requiredCurrentness))
    throw new Error('Solana fee quote is stale or not captured');
  const evidence = quotes.get(quote);
  if (!evidence) throw new Error('Solana fee quote was not captured');
  evidence.active = false;
  return readQuote(
    evidence.profile,
    evidence.session,
    evidence.intent,
    evidence.options,
    evidence.producers,
    quote.contextSlot,
    evidence.isCurrentSession,
    evidence,
  );
};
