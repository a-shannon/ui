import { Buffer } from 'buffer';

import { PublicKey } from '@solana/web3.js';

import type { SolanaLockFeeProducers } from './feeQuote';
import type { SolanaRpcTransport } from './rpcProtocol';
import {
  createRpcCaller,
  type JsonNode,
  member,
  type ObjectNode,
  readU64Value,
  stringValue,
} from './rpcProtocol';

const U64_MAX = 18_446_744_073_709_551_615n;
const MAX_MESSAGE_BYTES = 1232;
const TOKEN_ACCOUNT_BASE64_MAX_CHARS = 1_048_576;
const FINALIZED = 'finalized' as const;

/** The only mutable caller inputs retained by one provider instance. */
export interface SolanaRpcFeeProducerOptions {
  readonly expectedGenesisHash: string;
  readonly transport: SolanaRpcTransport;
  readonly readBalance: SolanaLockFeeProducers['readBalance'];
}

type DataRecord = Record<string, unknown>;

/** Throw one stable producer-boundary error without echoing remote response data. */
const fail = (code: string): never => {
  throw new Error(code);
};

/** Copy exact own enumerable data fields without invoking getters or retaining the input. */
const ownDataRecord = (value: unknown, fields: readonly string[], code: string): DataRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail(code);
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== 'string' || !fields.includes(key))
  )
    return fail(code);
  const captured: DataRecord = {};
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)
      return fail(code);
    captured[field] = descriptor.value;
  }
  return captured;
};

/** Require one canonical 32-byte base58 public key without coercion. */
const canonicalKey = (value: unknown, code: string): string => {
  if (typeof value !== 'string') return fail(code);
  try {
    if (new PublicKey(value).toBase58() !== value) return fail(code);
    return value;
  } catch {
    return fail(code);
  }
};

/** Require a raw bigint u64 and preserve it without Number conversion. */
const requestU64 = (value: unknown): bigint => {
  if (typeof value !== 'bigint' || value < 0n || value > U64_MAX)
    return fail('SOLANA_RPC_PRODUCER_REQUEST_INVALID');
  return value;
};

/** Require an AST object with exactly its required members and optional members. */
const exactObject = (
  node: JsonNode | undefined,
  required: readonly string[],
  optional: readonly string[] = [],
  code = 'SOLANA_RPC_PRODUCER_RESPONSE_INVALID',
): ObjectNode => {
  if (node?.kind !== 'object') return fail(code);
  const keys = [...node.members.keys()];
  if (
    keys.length < required.length ||
    keys.length > required.length + optional.length ||
    required.some((key) => !node.members.has(key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  )
    return fail(code);
  return node;
};

/** Parse a canonical base64 field and bound allocation before decoding it. */
const canonicalBase64 = (
  value: unknown,
  maxBytes: number,
  code: string,
  allowEmpty: boolean,
): { readonly text: string; readonly byteLength: number } => {
  if (typeof value !== 'string') return fail(code);
  if (value.length > Math.ceil(maxBytes / 3) * 4) return fail(code);
  if (
    (!allowEmpty && value.length === 0) ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  )
    return fail(code);
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || bytes.length > maxBytes) return fail(code);
  return { text: value, byteLength: bytes.length };
};

/** Validate a request's captured genesis identity before any asynchronous operation. */
const requestGenesis = (value: unknown, expected: string): string => {
  const genesis = canonicalKey(value, 'SOLANA_RPC_PRODUCER_REQUEST_INVALID');
  if (genesis !== expected) return fail('SOLANA_RPC_GENESIS_MISMATCH');
  return genesis;
};

/** Capture the exact context fields used by finalized data RPCs. */
const captureContextRequest = (
  value: unknown,
  fields: readonly string[],
  expectedGenesisHash: string,
): DataRecord => {
  const captured = ownDataRecord(value, fields, 'SOLANA_RPC_PRODUCER_REQUEST_INVALID');
  requestGenesis(captured.clusterGenesisHash, expectedGenesisHash);
  if (captured.commitment !== FINALIZED) return fail('SOLANA_RPC_PRODUCER_REQUEST_INVALID');
  requestU64(captured.minContextSlot);
  return captured;
};

/** Read an optional documented context apiVersion while retaining the exact u64 slot. */
const contextSlot = (context: JsonNode | undefined, floor?: bigint): bigint => {
  const record = exactObject(context, ['slot'], ['apiVersion'], 'SOLANA_RPC_CONTEXT_INVALID');
  if (record.members.has('apiVersion')) {
    if (stringValue(member(record, 'apiVersion')) === undefined)
      return fail('SOLANA_RPC_CONTEXT_INVALID');
  }
  const slot = readU64Value(member(record, 'slot'));
  if (floor !== undefined && slot < floor) return fail('SOLANA_RPC_CONTEXT_BELOW_FLOOR');
  return slot;
};

/** Require the exact contextual RPC result shell and validate its observed slot. */
const contextualValue = (
  result: JsonNode,
  floor: bigint,
): { readonly slot: bigint; readonly value: JsonNode } => {
  const record = exactObject(result, ['context', 'value']);
  const slot = contextSlot(member(record, 'context'), floor);
  const value = member(record, 'value');
  if (!value) return fail('SOLANA_RPC_PRODUCER_RESPONSE_INVALID');
  return { slot, value };
};

/** Require one observed cluster identity to match the factory's captured identity. */
const observeGenesis = async (
  call: ReturnType<typeof createRpcCaller>,
  expectedGenesisHash: string,
): Promise<void> => {
  const { result } = await call('getGenesisHash', []);
  const observed = canonicalKey(stringValue(result), 'SOLANA_RPC_GENESIS_INVALID');
  if (observed !== expectedGenesisHash) fail('SOLANA_RPC_GENESIS_MISMATCH');
};

/** Sandwich one logical data read between genesis checks and preserve its failure identity. */
const withGenesisSandwich = async <T>(
  call: ReturnType<typeof createRpcCaller>,
  expectedGenesisHash: string,
  read: () => Promise<T>,
): Promise<T> => {
  await observeGenesis(call, expectedGenesisHash);
  let result: T | undefined;
  let readFailed = false;
  let readError: unknown;
  try {
    result = await read();
  } catch (error) {
    readFailed = true;
    readError = error;
  }
  try {
    await observeGenesis(call, expectedGenesisHash);
  } catch (error) {
    if (!readFailed) throw error;
  }
  if (readFailed) throw readError;
  return result as T;
};

/** Validate full getAccountInfo fields while projecting only the existing fee-payer DTO. */
const feePayerAccount = (
  value: JsonNode,
): {
  readonly owner: string;
  readonly executable: boolean;
  readonly dataBase64: string;
  readonly lamports: bigint;
} => {
  const account = exactObject(
    value,
    ['data', 'executable', 'lamports', 'owner', 'rentEpoch'],
    ['space'],
    'SOLANA_RPC_FEE_PAYER_INVALID',
  );
  const owner = canonicalKey(stringValue(member(account, 'owner')), 'SOLANA_RPC_FEE_PAYER_INVALID');
  const executableNode = member(account, 'executable');
  if (executableNode?.kind !== 'atom' || typeof executableNode.value !== 'boolean')
    return fail('SOLANA_RPC_FEE_PAYER_INVALID');
  const lamports = readU64Value(member(account, 'lamports'));
  readU64Value(member(account, 'rentEpoch'));
  if (account.members.has('space')) readU64Value(member(account, 'space'));
  const data = member(account, 'data');
  if (data?.kind !== 'array' || data.items.length !== 2)
    return fail('SOLANA_RPC_FEE_PAYER_INVALID');
  const dataBase64 = canonicalBase64(
    stringValue(data.items[0]),
    TOKEN_ACCOUNT_BASE64_MAX_CHARS,
    'SOLANA_RPC_FEE_PAYER_INVALID',
    true,
  ).text;
  if (stringValue(data.items[1]) !== 'base64') return fail('SOLANA_RPC_FEE_PAYER_INVALID');
  return {
    owner,
    executable: executableNode.value,
    dataBase64,
    lamports,
  };
};

/** Capture six browser RPC callbacks without claiming authenticated or atomic node state. */
export const createSolanaRpcFeeProducers = (
  options: SolanaRpcFeeProducerOptions,
): SolanaLockFeeProducers => {
  const configured = ownDataRecord(
    options,
    ['expectedGenesisHash', 'transport', 'readBalance'],
    'SOLANA_RPC_PRODUCER_CONFIG_INVALID',
  );
  const expectedGenesisHash = canonicalKey(
    configured.expectedGenesisHash,
    'SOLANA_RPC_PRODUCER_CONFIG_INVALID',
  );
  if (typeof configured.transport !== 'function' || typeof configured.readBalance !== 'function')
    return fail('SOLANA_RPC_PRODUCER_CONFIG_INVALID');
  const transport = configured.transport as SolanaRpcTransport;
  const readBalance = configured.readBalance as SolanaLockFeeProducers['readBalance'];
  const call = createRpcCaller(transport);

  const producers: SolanaLockFeeProducers = {
    readBalance: async (request) => {
      const captured = ownDataRecord(
        request,
        ['address', 'clusterGenesisHash', 'commitment', 'minContextSlot'],
        'SOLANA_RPC_PRODUCER_REQUEST_INVALID',
      );
      const address = canonicalKey(captured.address, 'SOLANA_RPC_PRODUCER_REQUEST_INVALID');
      requestGenesis(captured.clusterGenesisHash, expectedGenesisHash);
      if (captured.commitment !== FINALIZED) return fail('SOLANA_RPC_PRODUCER_REQUEST_INVALID');
      const minContextSlot = requestU64(captured.minContextSlot);
      const capturedRequest = Object.freeze({
        address,
        clusterGenesisHash: expectedGenesisHash,
        commitment: FINALIZED,
        minContextSlot,
      });
      return withGenesisSandwich(call, expectedGenesisHash, () => readBalance(capturedRequest));
    },
    readLatestBlockhash: async (request) => {
      const captured = captureContextRequest(
        request,
        ['clusterGenesisHash', 'commitment', 'minContextSlot'],
        expectedGenesisHash,
      );
      const minContextSlot = captured.minContextSlot as bigint;
      return withGenesisSandwich(call, expectedGenesisHash, async () => {
        const { result } = await call('getLatestBlockhash', [
          Object.freeze({ commitment: FINALIZED, minContextSlot }),
        ]);
        const contextual = contextualValue(result, minContextSlot);
        const value = exactObject(contextual.value, ['blockhash', 'lastValidBlockHeight']);
        return Object.freeze({
          clusterGenesisHash: expectedGenesisHash,
          commitment: FINALIZED,
          contextSlot: contextual.slot,
          blockhash: canonicalKey(
            stringValue(member(value, 'blockhash')),
            'SOLANA_RPC_BLOCKHASH_INVALID',
          ),
          lastValidBlockHeight: readU64Value(member(value, 'lastValidBlockHeight')),
        });
      });
    },
    readFeePayer: async (request) => {
      const captured = ownDataRecord(
        request,
        ['clusterGenesisHash', 'commitment', 'minContextSlot', 'address'],
        'SOLANA_RPC_PRODUCER_REQUEST_INVALID',
      );
      requestGenesis(captured.clusterGenesisHash, expectedGenesisHash);
      if (captured.commitment !== FINALIZED) return fail('SOLANA_RPC_PRODUCER_REQUEST_INVALID');
      const minContextSlot = requestU64(captured.minContextSlot);
      const address = canonicalKey(captured.address, 'SOLANA_RPC_PRODUCER_REQUEST_INVALID');
      return withGenesisSandwich(call, expectedGenesisHash, async () => {
        const { result } = await call('getAccountInfo', [
          address,
          Object.freeze({
            commitment: FINALIZED,
            encoding: 'base64',
            minContextSlot,
          }),
        ]);
        const contextual = contextualValue(result, minContextSlot);
        if (contextual.value.kind === 'atom' && contextual.value.value === null)
          return fail('SOLANA_RPC_FEE_PAYER_UNAVAILABLE');
        const account = feePayerAccount(contextual.value);
        return Object.freeze({
          clusterGenesisHash: expectedGenesisHash,
          commitment: FINALIZED,
          contextSlot: contextual.slot,
          address,
          ...account,
        });
      });
    },
    readRentMinimum: async (request) => {
      const captured = ownDataRecord(
        request,
        ['clusterGenesisHash', 'commitment', 'dataLength'],
        'SOLANA_RPC_PRODUCER_REQUEST_INVALID',
      );
      requestGenesis(captured.clusterGenesisHash, expectedGenesisHash);
      if (captured.commitment !== FINALIZED || captured.dataLength !== 0)
        return fail('SOLANA_RPC_PRODUCER_REQUEST_INVALID');
      return withGenesisSandwich(call, expectedGenesisHash, async () => {
        const { result } = await call('getMinimumBalanceForRentExemption', [
          0,
          Object.freeze({ commitment: FINALIZED }),
        ]);
        return Object.freeze({
          clusterGenesisHash: expectedGenesisHash,
          commitment: FINALIZED,
          dataLength: 0,
          minimumLamports: readU64Value(result),
        });
      });
    },
    readMessageFee: async (request) => {
      const captured = ownDataRecord(
        request,
        ['clusterGenesisHash', 'commitment', 'minContextSlot', 'messageBase64'],
        'SOLANA_RPC_PRODUCER_REQUEST_INVALID',
      );
      requestGenesis(captured.clusterGenesisHash, expectedGenesisHash);
      if (captured.commitment !== FINALIZED) return fail('SOLANA_RPC_PRODUCER_REQUEST_INVALID');
      const minContextSlot = requestU64(captured.minContextSlot);
      const messageBase64 = canonicalBase64(
        captured.messageBase64,
        MAX_MESSAGE_BYTES,
        'SOLANA_RPC_MESSAGE_INVALID',
        false,
      ).text;
      return withGenesisSandwich(call, expectedGenesisHash, async () => {
        const { result } = await call('getFeeForMessage', [
          messageBase64,
          Object.freeze({ commitment: FINALIZED, minContextSlot }),
        ]);
        const contextual = contextualValue(result, minContextSlot);
        const feeLamports =
          contextual.value.kind === 'atom' && contextual.value.value === null
            ? null
            : readU64Value(contextual.value);
        return Object.freeze({
          clusterGenesisHash: expectedGenesisHash,
          commitment: FINALIZED,
          contextSlot: contextual.slot,
          messageBase64,
          feeLamports,
        });
      });
    },
    readBlockHeight: async (request) => {
      const captured = ownDataRecord(
        request,
        ['clusterGenesisHash', 'commitment', 'minContextSlot'],
        'SOLANA_RPC_PRODUCER_REQUEST_INVALID',
      );
      requestGenesis(captured.clusterGenesisHash, expectedGenesisHash);
      if (captured.commitment !== 'confirmed') return fail('SOLANA_RPC_PRODUCER_REQUEST_INVALID');
      const minContextSlot = requestU64(captured.minContextSlot);
      return withGenesisSandwich(call, expectedGenesisHash, async () => {
        const { result } = await call('getBlockHeight', [
          Object.freeze({ commitment: 'confirmed', minContextSlot }),
        ]);
        return Object.freeze({
          clusterGenesisHash: expectedGenesisHash,
          commitment: 'confirmed' as const,
          blockHeight: readU64Value(result),
        });
      });
    },
  };
  return Object.freeze(producers);
};
