/** Expected genesis identity used by the local RPC producer fixtures. */
export const EXPECTED_GENESIS_HASH = '11111111111111111111111111111111';
/** Distinct genesis identity used to exercise cluster-mismatch refusals. */
export const OTHER_GENESIS_HASH = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
/** Deterministic account address embedded in fee-producer RPC responses. */
export const TEST_ADDRESS = '11111111111111111111111111111111';
/** Deterministic blockhash embedded in latest-blockhash RPC responses. */
export const TEST_BLOCKHASH = '11111111111111111111111111111111';
/** Context-slot floor above Number.MAX_SAFE_INTEGER used to check bigint preservation. */
export const MIN_CONTEXT_SLOT = 9_007_199_254_740_993n;
/** Largest unsigned 64-bit value used in raw RPC boundary fixtures. */
export const U64_MAX = 18_446_744_073_709_551_615n;

/** Exact raw RPC numeric tokens that must never pass through JavaScript Number. */
export const invalidBlockHeightCases = [
  { name: 'fraction', lexeme: '1.5', error: 'SOLANA_RPC_INVALID_U64' },
  { name: 'exponent', lexeme: '1e3', error: 'SOLANA_RPC_INVALID_U64' },
  { name: 'negative integer', lexeme: '-1', error: 'SOLANA_RPC_INVALID_U64' },
  {
    name: 'one above u64',
    lexeme: '18446744073709551616',
    error: 'SOLANA_RPC_U64_OUT_OF_RANGE',
  },
] as const;

/** Malformed caller floor values are deliberately untyped runtime inputs. */
export const invalidFloorCases = [
  { name: 'fractional number', value: 1.5 },
  { name: 'exponent-shaped unsafe number', value: 1e20 },
  { name: 'negative bigint', value: -1n },
  { name: 'one above u64', value: U64_MAX + 1n },
  { name: 'number instead of bigint', value: 1 },
] as const;
