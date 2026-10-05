/** Exact JSON-number lexemes that must survive transport serialization. */
export const requestU64Cases = [
  { name: 'zero', value: 0n, lexeme: '0' },
  {
    name: 'above Number safe integer',
    value: 9007199254740993n,
    lexeme: '9007199254740993',
  },
  {
    name: 'maximum u64',
    value: 18446744073709551615n,
    lexeme: '18446744073709551615',
  },
] as const;

/** Invalid JavaScript numbers that cannot represent Solana JSON integer parameters. */
export const invalidRequestNumberCases = [
  { name: 'negative integer', value: -1 },
  { name: 'negative zero', value: -0 },
  { name: 'fraction', value: 1.5 },
  { name: 'exponent-form fraction', value: 1e-7 },
  { name: 'unsafe integer', value: 9007199254740992 },
  { name: 'NaN', value: Number.NaN },
  { name: 'positive infinity', value: Number.POSITIVE_INFINITY },
  { name: 'negative infinity', value: Number.NEGATIVE_INFINITY },
] as const;

/** Nested parameter depths around the serializer limit, excluding request-envelope fields. */
export const requestDepthCases = [
  { name: 'depth 64', nestedArrays: 62, accepted: true },
  { name: 'depth 65', nestedArrays: 63, accepted: false },
] as const;
