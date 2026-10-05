import { Buffer } from 'buffer';

import { PublicKey } from '@solana/web3.js';
import { expect } from 'vitest';

import { WRAPPED_SOL_MINT } from '@rosen-network/solana';

import { ORIGINAL_SPL_PROGRAM_ID } from './rpcAccountDecoderTestData';

export const TEST_WALLET = new PublicKey(Buffer.alloc(32, 5)).toBase58();
export const TEST_MINT = new PublicKey(Buffer.alloc(32, 6)).toBase58();
export const TEST_TOKEN_ACCOUNT = new PublicKey(Buffer.alloc(32, 7)).toBase58();

export type AccountRecord = {
  owner: string;
  executable: boolean;
  data: [string, 'base64'];
};

/** Builds the complete 165-byte original Token Program account fixture. */
export const tokenAccountRecord = (
  options: {
    readonly mint?: string;
    readonly owner?: string;
    readonly amount?: bigint;
    readonly stateTag?: number;
    readonly delegateTag?: number;
    readonly nativeTag?: number;
    readonly nativeReserve?: bigint;
    readonly closeAuthorityTag?: number;
  } = {},
): AccountRecord => {
  const bytes = Buffer.alloc(165);
  new PublicKey(options.mint ?? TEST_MINT).toBuffer().copy(bytes, 0);
  new PublicKey(options.owner ?? TEST_WALLET).toBuffer().copy(bytes, 32);
  bytes.writeBigUInt64LE(options.amount ?? 0n, 64);
  bytes.writeUInt32LE(options.delegateTag ?? 0, 72);
  bytes[108] = options.stateTag ?? 1;
  bytes.writeUInt32LE(options.nativeTag ?? 0, 109);
  if (options.nativeTag === 1) bytes.writeBigUInt64LE(options.nativeReserve ?? 0n, 113);
  bytes.writeBigUInt64LE(0n, 121);
  bytes.writeUInt32LE(options.closeAuthorityTag ?? 0, 129);
  return {
    owner: ORIGINAL_SPL_PROGRAM_ID,
    executable: false,
    data: [bytes.toString('base64'), 'base64'],
  };
};

/** Builds the complete 82-byte initialized original Token Program mint fixture. */
export const mintAccountRecord = (
  options: {
    readonly initialized?: boolean;
    readonly mintAuthorityTag?: number;
    readonly freezeAuthorityTag?: number;
    readonly decimals?: number;
    readonly supply?: bigint;
  } = {},
): AccountRecord => {
  const bytes = Buffer.alloc(82);
  bytes.writeUInt32LE(options.mintAuthorityTag ?? 0, 0);
  bytes.writeBigUInt64LE(options.supply ?? 0n, 36);
  bytes[44] = options.decimals ?? 9;
  bytes[45] = options.initialized === false ? 0 : 1;
  bytes.writeUInt32LE(options.freezeAuthorityTag ?? 0, 46);
  return {
    owner: ORIGINAL_SPL_PROGRAM_ID,
    executable: false,
    data: [bytes.toString('base64'), 'base64'],
  };
};

/** Applies one named binary or provider-metadata fault without hiding the fixture. */
export const tokenRecordWithFault = (record: AccountRecord, fault: string): unknown => {
  const bytes = Buffer.from(record.data[0], 'base64');
  switch (fault) {
    case 'program-owner':
      return { ...record, owner: TEST_WALLET };
    case 'executable':
      return { ...record, executable: true };
    case 'wrong-length':
      return {
        ...record,
        data: [bytes.subarray(0, 164).toString('base64'), 'base64'],
      };
    case 'invalid-base64':
      return { ...record, data: [`!${record.data[0].slice(1)}`, 'base64'] };
    case 'encoding-label':
      return { ...record, data: [record.data[0], 'base58'] };
    case 'invalid-state':
      bytes[108] = 3;
      break;
    case 'delegate-option':
      bytes.writeUInt32LE(2, 72);
      break;
    case 'native-option':
      bytes.writeUInt32LE(2, 109);
      break;
    case 'native-reserve-mint':
      bytes.writeUInt32LE(1, 109);
      bytes.writeBigUInt64LE(4n, 113);
      break;
    case 'close-option':
      bytes.writeUInt32LE(2, 129);
      break;
    default:
      throw new Error(`Unknown token-account fault: ${fault}`);
  }
  return { ...record, data: [bytes.toString('base64'), 'base64'] };
};

/** Applies one named binary or provider-metadata fault to a mint fixture. */
export const mintRecordWithFault = (record: AccountRecord, fault: string): unknown => {
  const bytes = Buffer.from(record.data[0], 'base64');
  switch (fault) {
    case 'program-owner':
      return { ...record, owner: TEST_WALLET };
    case 'executable':
      return { ...record, executable: true };
    case 'wrong-length':
      return {
        ...record,
        data: [bytes.subarray(0, 81).toString('base64'), 'base64'],
      };
    case 'invalid-base64':
      return { ...record, data: [`!${record.data[0].slice(1)}`, 'base64'] };
    case 'uninitialized':
      bytes[45] = 0;
      break;
    case 'mint-option':
      bytes.writeUInt32LE(2, 0);
      break;
    case 'freeze-option':
      bytes.writeUInt32LE(2, 46);
      break;
    default:
      throw new Error(`Unknown mint fault: ${fault}`);
  }
  return { ...record, data: [bytes.toString('base64'), 'base64'] };
};

/** Creates an 82-byte mint base64 string with nonzero unused padding bits. */
export const noncanonicalMintBase64 = (): string => {
  const encoded = mintAccountRecord().data[0];
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const index = encoded.length - 3;
  const paddingIndex = alphabet.indexOf(encoded[index]);
  return `${encoded.slice(0, index)}${alphabet[paddingIndex | 1]}==`;
};

/** Verifies both that an error was thrown and that its stable code is exact. */
export const expectDecoderError = (action: () => unknown, code: string): void => {
  let caught: unknown;
  const capture = () => {
    try {
      return action();
    } catch (error) {
      caught = error;
      throw error;
    }
  };
  expect(capture).toThrow(code);
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toEqual(code);
};

/** Provides the WSOL mint value used by the full-layout native-reserve case. */
export const wrappedSolMint = (): string => WRAPPED_SOL_MINT;
