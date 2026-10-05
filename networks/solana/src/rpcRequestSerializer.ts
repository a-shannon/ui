import type { SolanaRpcRequest } from './rpcProtocol';

const MAX_DEPTH = 64;
const MAX_NODES = 100_000;
const MAX_U64 = 18_446_744_073_709_551_615n;
const MAX_SERIALIZED_BYTES = 1_048_576;

/** Raises one stable request-serialization failure without including request data. */
const fail = (code: string): never => {
  throw new Error(code);
};

/** Measures UTF-8 bytes without allocating an encoded copy. */
const utf8ByteLength = (value: string): number => {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
};

/** Measures exact JSON string bytes before JSON.stringify allocates escaped output. */
const jsonStringByteLength = (value: string, maximumBytes: number): number => {
  let bytes = 2;
  if (bytes > maximumBytes) fail('SOLANA_RPC_REQUEST_TOO_LARGE');
  /** Adds a precomputed encoding size only while it fits within the remaining byte budget. */
  const add = (amount: number): void => {
    if (amount > maximumBytes - bytes) fail('SOLANA_RPC_REQUEST_TOO_LARGE');
    bytes += amount;
  };
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c) add(2);
    else if (code < 0x20) {
      if (code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) add(2);
      else add(6);
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        add(4);
        index += 1;
      } else add(6);
    } else if (code >= 0xdc00 && code <= 0xdfff) add(6);
    else if (code <= 0x7f) add(1);
    else if (code <= 0x7ff) add(2);
    else add(3);
  }
  return bytes;
};

/** Reads exact own data fields from an ordinary record without invoking accessors. */
const ownRecord = (
  value: unknown,
  fields: readonly string[],
  code = 'SOLANA_RPC_INVALID_REQUEST',
): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail(code);
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== 'string' || !fields.includes(key))
  )
    return fail(code);
  const record: Record<string, unknown> = {};
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)
      return fail(code);
    record[field] = descriptor.value;
  }
  return record;
};

/** Serializes a JSON-RPC request while preserving validated u64 BigInts as number lexemes. */
export const serializeSolanaRpcRequest = (request: SolanaRpcRequest, maxBytes: number): string => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_SERIALIZED_BYTES)
    return fail('SOLANA_RPC_SERIALIZER_CONFIG_INVALID');

  const envelope = ownRecord(request, ['jsonrpc', 'id', 'method', 'params']);
  if (envelope.jsonrpc !== '2.0') return fail('SOLANA_RPC_INVALID_REQUEST');
  if (
    typeof envelope.id !== 'number' ||
    !Number.isSafeInteger(envelope.id) ||
    envelope.id < 1 ||
    Object.is(envelope.id, -0)
  )
    return fail('SOLANA_RPC_INVALID_REQUEST_ID');
  if (typeof envelope.method !== 'string' || envelope.method.length === 0)
    return fail('SOLANA_RPC_INVALID_REQUEST_METHOD');
  if (!Array.isArray(envelope.params)) return fail('SOLANA_RPC_INVALID_REQUEST_PARAMS');

  let bytes = 0;
  let nodes = 0;
  const parts: string[] = [];
  const active = new WeakSet<object>();
  /** Enforces the serializer's recursive depth and total-node limits. */
  const countNode = (depth: number): void => {
    if (depth > MAX_DEPTH) fail('SOLANA_RPC_REQUEST_DEPTH_LIMIT');
    nodes += 1;
    if (nodes > MAX_NODES) fail('SOLANA_RPC_REQUEST_NODE_LIMIT');
  };
  /** Appends one encoded segment after checking its UTF-8 size against the request limit. */
  const append = (part: string): void => {
    if (part.length > maxBytes - bytes) fail('SOLANA_RPC_REQUEST_TOO_LARGE');
    const length = utf8ByteLength(part);
    if (length > maxBytes - bytes) fail('SOLANA_RPC_REQUEST_TOO_LARGE');
    bytes += length;
    parts.push(part);
  };
  /** Preflights a JSON string's escaped size before encoding and appending it. */
  const appendString = (value: string): void => {
    const remainingBytes = maxBytes - bytes;
    if (value.length > remainingBytes) fail('SOLANA_RPC_REQUEST_TOO_LARGE');
    jsonStringByteLength(value, remainingBytes);
    const encoded = JSON.stringify(value);
    if (typeof encoded !== 'string') fail('SOLANA_RPC_INVALID_REQUEST');
    append(encoded);
  };
  /** Serializes a dense ordinary array after validating its own enumerable data elements. */
  const serializeArray = (value: unknown[], depth: number): void => {
    countNode(depth);
    if (Object.getPrototypeOf(value) !== Array.prototype) fail('SOLANA_RPC_INVALID_REQUEST_VALUE');
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_NODES - nodes)
      fail('SOLANA_RPC_REQUEST_NODE_LIMIT');
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== length + 1 ||
      keys.some(
        (key) =>
          typeof key !== 'string' ||
          (key !== 'length' && (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)),
      )
    )
      fail('SOLANA_RPC_INVALID_REQUEST_ARRAY');
    append('[');
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined) fail('SOLANA_RPC_INVALID_REQUEST_ARRAY');
      const dataDescriptor = descriptor as PropertyDescriptor;
      if (!Object.hasOwn(dataDescriptor, 'value') || !dataDescriptor.enumerable)
        fail('SOLANA_RPC_INVALID_REQUEST_ARRAY');
      if (index > 0) append(',');
      serializeValue(dataDescriptor.value, depth + 1);
    }
    append(']');
  };
  /** Serializes an ordinary own-data object while rejecting cycles and unsupported members. */
  const serializeObject = (value: object, depth: number): void => {
    countNode(depth);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      fail('SOLANA_RPC_INVALID_REQUEST_VALUE');
    if (active.has(value)) fail('SOLANA_RPC_INVALID_REQUEST_CYCLE');
    active.add(value);
    try {
      const keys = Reflect.ownKeys(value);
      if (keys.length > MAX_NODES - nodes) fail('SOLANA_RPC_REQUEST_NODE_LIMIT');
      if (keys.some((key) => typeof key !== 'string' || key === 'toJSON'))
        fail('SOLANA_RPC_INVALID_REQUEST_VALUE');
      append('{');
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        if (typeof key !== 'string') fail('SOLANA_RPC_INVALID_REQUEST_VALUE');
        const stringKey = String(key);
        const descriptor = Object.getOwnPropertyDescriptor(value, stringKey);
        if (descriptor === undefined) fail('SOLANA_RPC_INVALID_REQUEST_VALUE');
        const dataDescriptor = descriptor as PropertyDescriptor;
        if (!Object.hasOwn(dataDescriptor, 'value') || !dataDescriptor.enumerable)
          fail('SOLANA_RPC_INVALID_REQUEST_VALUE');
        if (index > 0) append(',');
        appendString(stringKey);
        append(':');
        serializeValue(dataDescriptor.value, depth + 1);
      }
      append('}');
    } finally {
      active.delete(value);
    }
  };
  /** Serializes one JSON-safe value recursively, preserving validated u64 values as number lexemes. */
  const serializeValue = (value: unknown, depth: number): void => {
    countNode(depth);
    if (value === null) {
      append('null');
      return;
    }
    if (typeof value === 'string') {
      appendString(value);
      return;
    }
    if (typeof value === 'boolean') {
      append(value ? 'true' : 'false');
      return;
    }
    if (typeof value === 'bigint') {
      if (value < 0n) fail('SOLANA_RPC_INVALID_U64');
      if (value > MAX_U64) fail('SOLANA_RPC_U64_OUT_OF_RANGE');
      append(value.toString(10));
      return;
    }
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0))
        fail('SOLANA_RPC_INVALID_REQUEST_NUMBER');
      append(String(value));
      return;
    }
    if (Array.isArray(value)) {
      nodes -= 1;
      serializeArray(value, depth);
      return;
    }
    if (typeof value === 'object' && value !== null) {
      nodes -= 1;
      serializeObject(value, depth);
      return;
    }
    fail('SOLANA_RPC_INVALID_REQUEST_VALUE');
  };

  nodes = 1;
  append('{');
  appendString('jsonrpc');
  append(':');
  serializeValue(envelope.jsonrpc, 1);
  append(',');
  appendString('id');
  append(':');
  serializeValue(envelope.id, 1);
  append(',');
  appendString('method');
  append(':');
  serializeValue(envelope.method, 1);
  append(',');
  appendString('params');
  append(':');
  serializeValue(envelope.params, 1);
  append('}');
  return parts.join('');
};
