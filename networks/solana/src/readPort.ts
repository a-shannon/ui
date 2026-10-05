import { PublicKey } from '@solana/web3.js';

import {
  isCapturedSolanaLockProfile,
  SOLANA_SPL_PROGRAM_ID,
  SOLANA_U64_MAX,
  type SolanaLockProfile,
} from './lockProfile';
import type { SolanaWalletSession, SolanaWalletSessionCurrentness } from './walletSession';

export interface SolanaWalletReadRequest {
  readonly address: string;
  readonly clusterGenesisHash: string;
  readonly commitment: 'finalized';
}

/** Supplies validated account fields; this boundary does not decode RPC JSON or account bytes. */
export type SolanaWalletReadProducer = (request: SolanaWalletReadRequest) => Promise<unknown>;

export interface SolanaWalletTokenAccount {
  readonly address: string;
  readonly mint: string;
  readonly programId: string;
  readonly owner: string;
  readonly amount: bigint;
  readonly decimals: number;
  readonly state: 'initialized' | 'frozen';
}

/** The producer must assert both balances at the same finalized context slot. */
export interface SolanaWalletReadResult {
  readonly address: string;
  readonly clusterGenesisHash: string;
  readonly commitment: 'finalized';
  readonly nativeContextSlot: bigint;
  readonly tokenContextSlot: bigint;
  readonly nativeBalance: bigint;
  readonly tokenAccounts: readonly SolanaWalletTokenAccount[];
}

/**
 * Immutable raw inventory; matching slots do not establish an atomic or authenticated snapshot.
 * Native balance does not establish system ownership, spendability or fee/rent qualification.
 */
export interface SolanaWalletBalanceView {
  readonly publicKey: string;
  readonly clusterGenesisHash: string;
  readonly commitment: 'finalized';
  readonly contextSlot: bigint;
  readonly nativeBalance: bigint;
  readonly tokenAccounts: readonly SolanaWalletTokenAccount[];
}

interface BalanceEvidence {
  readonly session: SolanaWalletSession;
  readonly isCurrentSession: SolanaWalletSessionCurrentness;
  readonly profile: SolanaLockProfile;
}

const balanceEvidence = new WeakMap<SolanaWalletBalanceView, BalanceEvidence>();
const MAX_TOKEN_ACCOUNTS = 4096;

/** Copies exactly the expected own data properties without invoking accessors. */
const ownDataRecord = (
  value: unknown,
  fields: readonly string[],
  label: string,
): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError(`Invalid ${label}`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError(`Invalid ${label} prototype`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== 'string' || !fields.includes(key))
  )
    throw new TypeError(`Unexpected or missing ${label} fields`);
  const copied: Record<string, unknown> = {};
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !Object.hasOwn(descriptor, 'value'))
      throw new TypeError(`Invalid ${label} accessor`);
    copied[field] = descriptor.value;
  }
  return copied;
};

/** Copies a dense ordinary array and refuses extra fields, accessors and oversized inventory. */
const ownDataArray = (value: unknown): unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    throw new TypeError('Invalid token account inventory');
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_TOKEN_ACCOUNTS)
    throw new RangeError('Token account inventory exceeds 4096 entries');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== length + 1)
    throw new TypeError('Unexpected or missing token account inventory fields');
  const copied: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[index];
    if (!descriptor || !Object.hasOwn(descriptor, 'value'))
      throw new TypeError('Invalid token account inventory accessor or hole');
    copied.push(descriptor.value);
  }
  return copied;
};

/** Requires canonical base58 public keys without coercion. */
const canonicalKey = (value: unknown, label: string): string => {
  if (typeof value !== 'string') throw new TypeError(`Invalid ${label}`);
  try {
    if (new PublicKey(value).toBase58() !== value) throw new Error('noncanonical');
    return value;
  } catch {
    throw new TypeError(`Invalid ${label}`);
  }
};

/** Accepts only exact unsigned bigint values from the injected service. */
const rawU64 = (value: unknown, label: string): bigint => {
  if (typeof value !== 'bigint') throw new TypeError(`Invalid raw ${label}`);
  if (value < 0n || value > SOLANA_U64_MAX) throw new RangeError(`Invalid raw ${label} range`);
  return value;
};

/** Refuses a session whose originating provider, account or generation has changed. */
const requireCurrentSession = (
  session: SolanaWalletSession,
  isCurrentSession: SolanaWalletSessionCurrentness,
): void => {
  if (!isCurrentSession(session)) throw new Error('Solana wallet session is stale');
};

/** Validates every original-SPL account, including accounts ineligible for bridge selection. */
const captureTokenAccount = (value: unknown, publicKey: string): SolanaWalletTokenAccount => {
  const record = ownDataRecord(
    value,
    ['address', 'mint', 'programId', 'owner', 'amount', 'decimals', 'state'],
    'token account',
  );
  const address = canonicalKey(record.address, 'token account address');
  const mint = canonicalKey(record.mint, 'token account mint');
  const programId = canonicalKey(record.programId, 'token account program');
  const owner = canonicalKey(record.owner, 'token account owner');
  if (programId !== SOLANA_SPL_PROGRAM_ID) throw new TypeError('Unsupported token account program');
  if (owner !== publicKey) throw new TypeError('Token account owner differs from wallet session');
  if (
    typeof record.decimals !== 'number' ||
    !Number.isInteger(record.decimals) ||
    record.decimals < 0 ||
    record.decimals > 255
  )
    throw new RangeError('Invalid token account decimals');
  if (record.state !== 'initialized' && record.state !== 'frozen')
    throw new TypeError('Invalid token account state');
  return Object.freeze({
    address,
    mint,
    programId,
    owner,
    amount: rawU64(record.amount, 'token amount'),
    decimals: record.decimals,
    state: record.state,
  });
};

/**
 * Reads raw SOL and individual original-SPL accounts through one injected service.
 * Account details and finality are service assertions, not independently authenticated here.
 */
export const readSolanaWalletBalance = async (
  profile: SolanaLockProfile,
  session: SolanaWalletSession,
  producer: SolanaWalletReadProducer,
  isCurrentSession: SolanaWalletSessionCurrentness,
): Promise<SolanaWalletBalanceView> => {
  if (!isCapturedSolanaLockProfile(profile))
    throw new TypeError('Solana lock profile was not captured');
  if (typeof isCurrentSession !== 'function') throw new TypeError('Invalid wallet session check');
  requireCurrentSession(session, isCurrentSession);
  if (typeof producer !== 'function') throw new TypeError('Invalid Solana wallet read producer');
  const publicKey = canonicalKey(session.publicKey, 'wallet session public key');
  const request = Object.freeze({
    address: publicKey,
    clusterGenesisHash: profile.clusterGenesisHash,
    commitment: 'finalized' as const,
  });
  const response = await producer(request);
  requireCurrentSession(session, isCurrentSession);
  const record = ownDataRecord(
    response,
    [
      'address',
      'clusterGenesisHash',
      'commitment',
      'nativeContextSlot',
      'tokenContextSlot',
      'nativeBalance',
      'tokenAccounts',
    ],
    'wallet read result',
  );
  if (canonicalKey(record.address, 'wallet read address') !== publicKey)
    throw new TypeError('Solana read address differs from captured wallet session');
  const clusterGenesisHash = canonicalKey(record.clusterGenesisHash, 'cluster genesis hash');
  if (clusterGenesisHash !== profile.clusterGenesisHash)
    throw new TypeError('Solana read cluster differs from captured profile');
  if (record.commitment !== 'finalized')
    throw new TypeError('Solana read must use finalized commitment');
  const contextSlot = rawU64(record.nativeContextSlot, 'native context slot');
  if (contextSlot !== rawU64(record.tokenContextSlot, 'token context slot'))
    throw new TypeError('Solana read context slots differ');
  const nativeBalance = rawU64(record.nativeBalance, 'native balance');
  const tokenAccounts = ownDataArray(record.tokenAccounts).map((account) =>
    captureTokenAccount(account, publicKey),
  );
  const addresses = new Set<string>();
  for (const account of tokenAccounts) {
    if (addresses.has(account.address)) throw new TypeError('Duplicate token account address');
    addresses.add(account.address);
  }
  requireCurrentSession(session, isCurrentSession);
  const view = Object.freeze({
    publicKey,
    clusterGenesisHash,
    commitment: 'finalized' as const,
    contextSlot,
    nativeBalance,
    tokenAccounts: Object.freeze(tokenAccounts),
  });
  balanceEvidence.set(view, { session, isCurrentSession, profile });
  return view;
};

/** Confirms local provenance and current session before using a captured raw balance view. */
export const isCurrentSolanaWalletBalanceView = (
  value: unknown,
): value is SolanaWalletBalanceView => {
  if (typeof value !== 'object' || value === null) return false;
  const evidence = balanceEvidence.get(value as SolanaWalletBalanceView);
  if (!evidence) return false;
  try {
    return (
      isCapturedSolanaLockProfile(evidence.profile) && evidence.isCurrentSession(evidence.session)
    );
  } catch {
    return false;
  }
};

/** Selects one explicitly named, initialized account matching the captured bridge asset policy. */
export const selectSolanaSourceTokenAccount = (
  view: SolanaWalletBalanceView,
  asset: string,
  accountAddress: string,
): SolanaWalletTokenAccount => {
  if (!isCurrentSolanaWalletBalanceView(view))
    throw new Error('Solana balance view is stale or not captured');
  const evidence = balanceEvidence.get(view);
  if (!evidence) throw new TypeError('Solana balance view was not captured');
  const mint = canonicalKey(asset, 'selected SPL mint');
  const address = canonicalKey(accountAddress, 'selected source token account');
  const policy = Object.hasOwn(evidence.profile.assets, mint)
    ? evidence.profile.assets[mint]
    : undefined;
  if (policy?.kind !== 'spl') throw new TypeError('Selected SPL mint is not in captured allowlist');
  const account = view.tokenAccounts.find((candidate) => candidate.address === address);
  if (!account || account.mint !== mint)
    throw new TypeError('Selected source account does not match SPL mint');
  if (account.state !== 'initialized') throw new TypeError('Selected source account is frozen');
  if (account.decimals !== policy.sourceDecimals)
    throw new TypeError('Selected source account decimals differ from captured policy');
  requireCurrentSession(evidence.session, evidence.isCurrentSession);
  return account;
};
