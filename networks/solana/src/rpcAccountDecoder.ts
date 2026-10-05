import { Buffer } from 'buffer';

import { PublicKey } from '@solana/web3.js';

const ORIGINAL_SPL_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_ACCOUNT_LENGTH = 165;
const MINT_LENGTH = 82;

export const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface SolanaRpcTokenAccount {
  readonly address: string;
  readonly mint: string;
  readonly owner: string;
  readonly amount: bigint;
  readonly state: 'initialized' | 'frozen';
  readonly nativeReserve: bigint | null;
}

export interface SolanaRpcMint {
  readonly address: string;
  readonly decimals: number;
}

type RecordValue = Record<string, unknown>;

/** Raise one stable account-layout failure code. */
const fail = (code: string): never => {
  throw new Error(code);
};

/** Require a plain own-data record with exactly the provider-selected fields. */
const selectedAccountRecord = (value: unknown): RecordValue => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return fail('SOLANA_ASSET_ACCOUNT_INVALID');
  if (Object.getPrototypeOf(value) !== Object.prototype)
    return fail('SOLANA_ASSET_ACCOUNT_INVALID');
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 3 ||
    keys.some((key) => typeof key !== 'string' || !['owner', 'executable', 'data'].includes(key))
  )
    return fail('SOLANA_ASSET_ACCOUNT_INVALID');
  for (const key of keys) {
    if (typeof key !== 'string') return fail('SOLANA_ASSET_ACCOUNT_INVALID');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)
      return fail('SOLANA_ASSET_ACCOUNT_INVALID');
  }
  return value as RecordValue;
};

/** Require a canonical base58 public key that decodes to exactly 32 bytes. */
const publicKeyText = (value: unknown, code: string): string => {
  if (typeof value !== 'string') return fail(code);
  try {
    const key = new PublicKey(value);
    if (key.toBase58() !== value) return fail(code);
    return value;
  } catch {
    return fail(code);
  }
};

/** Encode one exact 32-byte public key from the original Token Program layout. */
const keyFromBytes = (bytes: Buffer): string => {
  if (bytes.length !== 32) return fail('SOLANA_ASSET_ACCOUNT_ADDRESS_INVALID');
  try {
    return new PublicKey(bytes).toBase58();
  } catch {
    return fail('SOLANA_ASSET_ACCOUNT_ADDRESS_INVALID');
  }
};

/** Validate selected account metadata and decode the complete canonical base64 body. */
const accountBytes = (value: unknown, expectedLength: number): Buffer => {
  const record = selectedAccountRecord(value);
  if (record.owner !== ORIGINAL_SPL_PROGRAM_ID)
    return fail('SOLANA_ASSET_ACCOUNT_PROGRAM_OWNER_MISMATCH');
  if (record.executable !== false) return fail('SOLANA_ASSET_ACCOUNT_EXECUTABLE');
  const data = record.data;
  if (!Array.isArray(data) || Object.getPrototypeOf(data) !== Array.prototype)
    return fail('SOLANA_ASSET_ACCOUNT_DATA_INVALID');
  const keys = Reflect.ownKeys(data);
  if (keys.length !== 3 || !keys.includes('0') || !keys.includes('1') || !keys.includes('length'))
    return fail('SOLANA_ASSET_ACCOUNT_DATA_INVALID');
  const first = Object.getOwnPropertyDescriptor(data, '0');
  const second = Object.getOwnPropertyDescriptor(data, '1');
  const length = Object.getOwnPropertyDescriptor(data, 'length');
  if (
    !first ||
    !Object.hasOwn(first, 'value') ||
    !first.enumerable ||
    !second ||
    !Object.hasOwn(second, 'value') ||
    !second.enumerable ||
    !length ||
    !Object.hasOwn(length, 'value') ||
    length.value !== 2
  )
    return fail('SOLANA_ASSET_ACCOUNT_DATA_INVALID');
  const encoded = first.value;
  if (
    typeof encoded !== 'string' ||
    second.value !== 'base64' ||
    encoded.length !== Math.ceil(expectedLength / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)
  )
    return fail('SOLANA_ASSET_ACCOUNT_DATA_INVALID');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded || bytes.length !== expectedLength)
    return fail('SOLANA_ASSET_ACCOUNT_DATA_INVALID');
  return bytes;
};

/** Decode a COption key, validating the complete tag and optional key bytes. */
const cOptionKey = (bytes: Buffer, offset: number): string | null => {
  const tag = bytes.readUInt32LE(offset);
  if (tag === 0) return null;
  if (tag !== 1) return fail('SOLANA_ASSET_ACCOUNT_OPTION_TAG_INVALID');
  return keyFromBytes(bytes.subarray(offset + 4, offset + 36));
};

/** Decode one full original Token Program account bound to its requested owner. */
export const decodeSolanaRpcTokenAccount = (
  addressValue: unknown,
  accountValue: unknown,
  requestedOwnerValue: unknown,
): SolanaRpcTokenAccount => {
  const address = publicKeyText(addressValue, 'SOLANA_ASSET_ACCOUNT_ADDRESS_INVALID');
  const requestedOwner = publicKeyText(requestedOwnerValue, 'SOLANA_ASSET_WALLET_INVALID');
  const bytes = accountBytes(accountValue, TOKEN_ACCOUNT_LENGTH);
  const mint = keyFromBytes(bytes.subarray(0, 32));
  const owner = keyFromBytes(bytes.subarray(32, 64));
  if (owner !== requestedOwner) return fail('SOLANA_ASSET_ACCOUNT_WALLET_OWNER_MISMATCH');
  const amount = bytes.readBigUInt64LE(64);
  cOptionKey(bytes, 72);
  const stateTag = bytes[108];
  const state = stateTag === 1 ? 'initialized' : stateTag === 2 ? 'frozen' : null;
  if (!state) return fail('SOLANA_ASSET_ACCOUNT_STATE_INVALID');
  const nativeTag = bytes.readUInt32LE(109);
  if (nativeTag !== 0 && nativeTag !== 1) return fail('SOLANA_ASSET_ACCOUNT_OPTION_TAG_INVALID');
  const nativeReserve = nativeTag === 1 ? bytes.readBigUInt64LE(113) : null;
  if (nativeReserve !== null && mint !== WRAPPED_SOL_MINT)
    return fail('SOLANA_ASSET_NATIVE_RESERVE_MINT_MISMATCH');
  bytes.readBigUInt64LE(121);
  cOptionKey(bytes, 129);
  return Object.freeze({ address, mint, owner, amount, state, nativeReserve });
};

/** Decode an initialized original-program mint without inferring token metadata. */
export const decodeSolanaRpcMint = (
  addressValue: unknown,
  accountValue: unknown,
): SolanaRpcMint => {
  const address = publicKeyText(addressValue, 'SOLANA_ASSET_MINT_INVALID');
  const bytes = accountBytes(accountValue, MINT_LENGTH);
  cOptionKey(bytes, 0);
  bytes.readBigUInt64LE(36);
  const decimals = bytes[44];
  if (bytes[45] !== 1) return fail('SOLANA_ASSET_MINT_UNINITIALIZED');
  cOptionKey(bytes, 46);
  return Object.freeze({ address, decimals });
};
