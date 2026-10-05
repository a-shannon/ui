import { PublicKey } from '@solana/web3.js';
import { Address, NetworkPrefix } from 'ergo-lib-wasm-nodejs';

export const SOLANA_NATIVE_ASSET = 'SOL';
export const SOLANA_MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const SOLANA_SPL_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const SOLANA_SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
export const SOLANA_U64_MAX = (1n << 64n) - 1n;
export const ERGO_SIGNED_AMOUNT_MAX = (1n << 63n) - 1n;

const WSOL_MINTS = new Set([
  'So11111111111111111111111111111111111111112',
  '9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP',
]);

export interface SolanaLockAssetPolicy {
  readonly kind: 'native' | 'spl';
  readonly sourceDecimals: number;
  readonly destinationDecimals: number;
  readonly destinationTokenId: string;
  readonly minimumGrossAmount: string;
  readonly maximumGrossAmount: string;
  readonly networkFee: string;
  readonly bridgeFee: string;
  readonly vaultTokenAccount?: string;
}

export interface SolanaLockProfileInput {
  readonly clusterGenesisHash: string;
  readonly destinationNetwork: 'mainnet' | 'testnet';
  readonly vaultOwner: string;
  readonly memoVersion: 1;
  readonly assets: Readonly<Record<string, SolanaLockAssetPolicy>>;
}

export type SolanaLockProfile = SolanaLockProfileInput;

const capturedProfiles = new WeakSet<object>();

/** Distinguishes record-shaped configuration from primitives and arrays. */
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Rejects omitted and additional policy fields. */
const exactKeys = (value: Record<string, unknown>, keys: string[]): void => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw new TypeError('Unexpected or missing Solana lock profile fields');
};

/** Requires a canonical base58 encoding of exactly one Solana public key. */
const parsePublicKey = (value: unknown, label: string): PublicKey => {
  if (typeof value !== 'string') throw new TypeError(`Invalid ${label}`);
  try {
    const publicKey = new PublicKey(value);
    if (publicKey.toBase58() !== value) throw new Error('noncanonical');
    return publicKey;
  } catch {
    throw new TypeError(`Invalid ${label}`);
  }
};

/** Parses canonical, bounded source-chain units without Number conversion. */
const parseUint = (value: unknown, label: string): bigint => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value))
    throw new TypeError(`Invalid ${label}`);
  const parsed = BigInt(value);
  if (parsed > SOLANA_U64_MAX) throw new RangeError(`${label} exceeds u64`);
  return parsed;
};

/** Bounds the decimal scale accepted by the companion extractor. */
const validateDecimals = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 18)
    throw new RangeError(`Invalid ${label}`);
  return value;
};

/** Requires lossless conversion into the destination's signed amount range. */
const toErgoUnits = (
  amount: bigint,
  sourceDecimals: number,
  destinationDecimals: number,
): bigint => {
  const decimalDelta = destinationDecimals - sourceDecimals;
  const converted =
    decimalDelta >= 0
      ? amount * 10n ** BigInt(decimalDelta)
      : (() => {
          const divisor = 10n ** BigInt(-decimalDelta);
          if (amount % divisor !== 0n)
            throw new RangeError('Solana amount would lose destination units');
          return amount / divisor;
        })();
  if (converted > ERGO_SIGNED_AMOUNT_MAX)
    throw new RangeError('Converted amount exceeds Ergo signed range');
  return converted;
};

/** Freezes copied profile records recursively. */
const freezeTree = <T>(value: T): T => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeTree(child);
  return value;
};

/** Checks canonical address encoding and the configured Ergo network prefix. */
const validateErgoAddress = (address: unknown, network: string): void => {
  if (typeof address !== 'string' || address.length > 256)
    throw new TypeError('Invalid Ergo destination');
  let parsed: Address | undefined;
  try {
    parsed = Address.from_base58(address);
    const expectedPrefix = network === 'mainnet' ? NetworkPrefix.Mainnet : NetworkPrefix.Testnet;
    if (parsed.to_base58(expectedPrefix) !== address)
      throw new TypeError('Ergo destination network mismatch');
  } catch {
    throw new TypeError('Invalid Ergo destination for captured network');
  } finally {
    parsed?.free();
  }
};

/**
 * Copies and freezes one explicit cluster/vault/asset policy for subsequent
 * lock requests. Amount limits and fees are source-chain integer units.
 */
export const captureSolanaLockProfile = (input: SolanaLockProfileInput): SolanaLockProfile => {
  const value = structuredClone(input);
  if (!record(value)) throw new TypeError('Invalid Solana lock profile');
  exactKeys(value, [
    'clusterGenesisHash',
    'destinationNetwork',
    'vaultOwner',
    'memoVersion',
    'assets',
  ]);
  parsePublicKey(value.clusterGenesisHash, 'cluster genesis hash');
  parsePublicKey(value.vaultOwner, 'vault owner');
  if (value.destinationNetwork !== 'mainnet' && value.destinationNetwork !== 'testnet')
    throw new TypeError('Unsupported Ergo destination network');
  if (value.memoVersion !== 1) throw new TypeError('Unsupported Memo version');
  if (!record(value.assets)) throw new TypeError('Invalid asset allowlist');
  const assetEntries = Object.entries(value.assets);
  if (assetEntries.length === 0 || assetEntries.length > 16)
    throw new RangeError('Asset allowlist must contain 1 to 16 entries');

  const assets: Record<string, SolanaLockAssetPolicy> = {};
  for (const [assetId, rawPolicy] of assetEntries) {
    if (!record(rawPolicy)) throw new TypeError(`Invalid asset policy: ${assetId}`);
    const isNative = assetId === SOLANA_NATIVE_ASSET;
    exactKeys(
      rawPolicy,
      isNative
        ? [
            'kind',
            'sourceDecimals',
            'destinationDecimals',
            'destinationTokenId',
            'minimumGrossAmount',
            'maximumGrossAmount',
            'networkFee',
            'bridgeFee',
          ]
        : [
            'kind',
            'sourceDecimals',
            'destinationDecimals',
            'destinationTokenId',
            'minimumGrossAmount',
            'maximumGrossAmount',
            'networkFee',
            'bridgeFee',
            'vaultTokenAccount',
          ],
    );
    if (rawPolicy.kind !== (isNative ? 'native' : 'spl'))
      throw new TypeError(`Asset kind does not match allowlist key: ${assetId}`);
    if (!isNative) {
      parsePublicKey(assetId, 'SPL mint');
      if (WSOL_MINTS.has(assetId)) throw new TypeError('Wrapped SOL is not a supported asset');
      const vaultTokenAccount = parsePublicKey(rawPolicy.vaultTokenAccount, 'vault token account');
      if (vaultTokenAccount.toBase58() === assetId)
        throw new TypeError('Vault token account cannot equal its mint');
    } else if (rawPolicy.vaultTokenAccount !== undefined) {
      throw new TypeError('Native SOL policy cannot include a token account');
    }
    const sourceDecimals = validateDecimals(rawPolicy.sourceDecimals, 'source decimals');
    if (isNative && sourceDecimals !== 9) throw new RangeError('Native SOL uses 9 source decimals');
    const destinationDecimals = validateDecimals(
      rawPolicy.destinationDecimals,
      'destination decimals',
    );
    if (
      typeof rawPolicy.destinationTokenId !== 'string' ||
      !/^[0-9a-f]{64}$/.test(rawPolicy.destinationTokenId)
    )
      throw new TypeError(`Invalid destination token id: ${assetId}`);
    const minimum = parseUint(rawPolicy.minimumGrossAmount, 'minimum amount');
    const maximum = parseUint(rawPolicy.maximumGrossAmount, 'maximum amount');
    const networkFee = parseUint(rawPolicy.networkFee, 'network fee');
    const bridgeFee = parseUint(rawPolicy.bridgeFee, 'bridge fee');
    if (minimum === 0n || maximum < minimum || networkFee + bridgeFee >= minimum)
      throw new RangeError(`Invalid amount or fee bounds: ${assetId}`);
    toErgoUnits(minimum, sourceDecimals, destinationDecimals);
    toErgoUnits(maximum, sourceDecimals, destinationDecimals);
    toErgoUnits(networkFee, sourceDecimals, destinationDecimals);
    toErgoUnits(bridgeFee, sourceDecimals, destinationDecimals);
    assets[assetId] = {
      kind: rawPolicy.kind,
      sourceDecimals,
      destinationDecimals,
      destinationTokenId: rawPolicy.destinationTokenId,
      minimumGrossAmount: minimum.toString(),
      maximumGrossAmount: maximum.toString(),
      networkFee: networkFee.toString(),
      bridgeFee: bridgeFee.toString(),
      ...(!isNative
        ? {
            vaultTokenAccount: parsePublicKey(
              rawPolicy.vaultTokenAccount,
              'vault token account',
            ).toBase58(),
          }
        : {}),
    };
  }

  const profile = freezeTree({
    clusterGenesisHash: value.clusterGenesisHash,
    destinationNetwork: value.destinationNetwork,
    vaultOwner: value.vaultOwner,
    memoVersion: 1 as const,
    assets,
  });
  capturedProfiles.add(profile);
  return profile;
};

/** Confirms that a value came from captureSolanaLockProfile. */
export const isCapturedSolanaLockProfile = (value: SolanaLockProfile): boolean =>
  capturedProfiles.has(value);

/** Validates a target address against the profile's captured Ergo network. */
export const validateSolanaLockTarget = (address: unknown, profile: SolanaLockProfile): void =>
  validateErgoAddress(address, profile.destinationNetwork);
