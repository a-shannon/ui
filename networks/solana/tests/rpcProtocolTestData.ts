/** Maximum encoded response size accepted by the parser, in UTF-8 bytes. */
const MAX_RESPONSE_BYTES = 1_048_576;

/** Exact raw numeric tokens used to prove u64 parsing never passes through Number. */
export const u64ValueCases = [
  { name: 'zero', lexeme: '0', expected: 0n },
  { name: 'above Number safe integer', lexeme: '9007199254740993', expected: 9007199254740993n },
  {
    name: 'maximum u64',
    lexeme: '18446744073709551615',
    expected: 18446744073709551615n,
  },
] as const;

/** Malformed or out-of-range raw numeric tokens and their exact stable error codes. */
export const invalidU64ValueCases = [
  { name: 'fraction', lexeme: '1.5', error: 'SOLANA_RPC_INVALID_U64' },
  { name: 'exponent', lexeme: '1e3', error: 'SOLANA_RPC_INVALID_U64' },
  { name: 'negative integer', lexeme: '-1', error: 'SOLANA_RPC_INVALID_U64' },
  {
    name: 'one above maximum u64',
    lexeme: '18446744073709551616',
    error: 'SOLANA_RPC_U64_OUT_OF_RANGE',
  },
] as const;

/** Exact envelope bodies isolate duplicate, correlation-id, and JSON-RPC version failures. */
export const invalidEnvelopeCases = [
  {
    name: 'duplicate JSON key',
    raw: '{"jsonrpc":"2.0","jsonrpc":"2.0","id":1,"result":null}',
    error: 'SOLANA_RPC_DUPLICATE_JSON_KEY',
  },
  {
    name: 'mismatched request id',
    raw: '{"jsonrpc":"2.0","id":2,"result":null}',
    error: 'SOLANA_RPC_ID_MISMATCH',
  },
  {
    name: 'unsupported JSON-RPC version',
    raw: '{"jsonrpc":"1.0","id":1,"result":null}',
    error: 'SOLANA_RPC_VERSION_MISMATCH',
  },
] as const;

/** JSON prefix used to construct the response-size boundary fixtures. */
const byteLimitPrefix = '{"value":"';
/** JSON suffix paired with the size-fixture prefix to form a complete object. */
const byteLimitSuffix = '"}';
/** Multibyte tail that distinguishes UTF-8 byte length from JavaScript string length. */
const multibyteTail = 'é';
/** ASCII padding that places the encoded response exactly at the configured byte cap. */
const asciiPaddingBytes =
  MAX_RESPONSE_BYTES -
  new TextEncoder().encode(byteLimitPrefix).byteLength -
  new TextEncoder().encode(byteLimitSuffix).byteLength -
  new TextEncoder().encode(multibyteTail).byteLength;

type ResponseByteLimitCase = {
  readonly name: string;
  readonly raw: string;
  readonly byteLength: number;
  readonly expectedKind?: string;
  readonly error?: string;
};

/** Valid JSON strings at and one byte beyond the UTF-8 response cap. */
export const responseByteLimitCases: readonly ResponseByteLimitCase[] = [
  {
    name: 'accepts exactly 1048576 UTF-8 bytes',
    raw: byteLimitPrefix + 'a'.repeat(asciiPaddingBytes) + multibyteTail + byteLimitSuffix,
    byteLength: MAX_RESPONSE_BYTES,
    expectedKind: 'object',
  },
  {
    name: 'rejects 1048577 UTF-8 bytes before parsing',
    raw: byteLimitPrefix + 'a'.repeat(asciiPaddingBytes + 1) + multibyteTail + byteLimitSuffix,
    byteLength: MAX_RESPONSE_BYTES + 1,
    error: 'SOLANA_RPC_RESPONSE_TOO_LARGE',
  },
];

type DepthLimitCase = {
  readonly name: string;
  readonly depth: number;
  readonly expectedKind?: string;
  readonly error?: string;
};

/** Nested arrays with an exact leaf depth, independent of byte and node limits. */
export const depthLimitCases: readonly DepthLimitCase[] = [
  { name: 'depth 64 is accepted', depth: 64, expectedKind: 'array' },
  { name: 'depth 65 is rejected', depth: 65, error: 'SOLANA_RPC_DEPTH_LIMIT' },
];

type NodeLimitCase = {
  readonly name: string;
  readonly scalarCount: number;
  readonly expectedKind?: string;
  readonly error?: string;
};

/** Arrays whose root plus scalar children reach the exact parser node limit. */
export const nodeLimitCases: readonly NodeLimitCase[] = [
  { name: '100000 nodes are accepted', scalarCount: 99_999, expectedKind: 'array' },
  { name: '100001 nodes are rejected', scalarCount: 100_000, error: 'SOLANA_RPC_NODE_LIMIT' },
];
