/** Original SPL Token program identifier used to build and validate account records. */
export const ORIGINAL_SPL_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

/** Raw token amounts that exercise values above JavaScript's safe integer range and the u64 ceiling. */
export const tokenAmountCases = [
  { name: 'above Number safe integer', amount: 9_007_199_254_740_993n },
  { name: 'maximum u64', amount: 18_446_744_073_709_551_615n },
] as const;

/** Account-state tags supported by the decoder, paired with their immutable decoded state names. */
export const tokenStateCases = [
  { name: 'initialized state', stateTag: 1, expected: 'initialized' },
  { name: 'frozen state', stateTag: 2, expected: 'frozen' },
] as const;

/** Independent token-account record defects and the stable decoder error expected for each one. */
export const tokenRecordFaultCases = [
  {
    name: 'incorrect account program owner',
    fault: 'program-owner',
    error: 'SOLANA_ASSET_ACCOUNT_PROGRAM_OWNER_MISMATCH',
  },
  {
    name: 'executable account',
    fault: 'executable',
    error: 'SOLANA_ASSET_ACCOUNT_EXECUTABLE',
  },
  {
    name: 'wrong account data length',
    fault: 'wrong-length',
    error: 'SOLANA_ASSET_ACCOUNT_DATA_INVALID',
  },
  {
    name: 'invalid base64 alphabet',
    fault: 'invalid-base64',
    error: 'SOLANA_ASSET_ACCOUNT_DATA_INVALID',
  },
  {
    name: 'incorrect account data encoding label',
    fault: 'encoding-label',
    error: 'SOLANA_ASSET_ACCOUNT_DATA_INVALID',
  },
  {
    name: 'state outside initialized or frozen',
    fault: 'invalid-state',
    error: 'SOLANA_ASSET_ACCOUNT_STATE_INVALID',
  },
  {
    name: 'delegate COption tag',
    fault: 'delegate-option',
    error: 'SOLANA_ASSET_ACCOUNT_OPTION_TAG_INVALID',
  },
  {
    name: 'native-reserve COption tag',
    fault: 'native-option',
    error: 'SOLANA_ASSET_ACCOUNT_OPTION_TAG_INVALID',
  },
  {
    name: 'native reserve on a non-WSOL mint',
    fault: 'native-reserve-mint',
    error: 'SOLANA_ASSET_NATIVE_RESERVE_MINT_MISMATCH',
  },
  {
    name: 'close-authority COption tag',
    fault: 'close-option',
    error: 'SOLANA_ASSET_ACCOUNT_OPTION_TAG_INVALID',
  },
] as const;

/** Independent mint-record defects and the stable decoder error expected for each one. */
export const mintRecordFaultCases = [
  {
    name: 'incorrect mint program owner',
    fault: 'program-owner',
    error: 'SOLANA_ASSET_ACCOUNT_PROGRAM_OWNER_MISMATCH',
  },
  {
    name: 'executable mint',
    fault: 'executable',
    error: 'SOLANA_ASSET_ACCOUNT_EXECUTABLE',
  },
  {
    name: 'wrong mint data length',
    fault: 'wrong-length',
    error: 'SOLANA_ASSET_ACCOUNT_DATA_INVALID',
  },
  {
    name: 'invalid mint base64 alphabet',
    fault: 'invalid-base64',
    error: 'SOLANA_ASSET_ACCOUNT_DATA_INVALID',
  },
  {
    name: 'uninitialized mint',
    fault: 'uninitialized',
    error: 'SOLANA_ASSET_MINT_UNINITIALIZED',
  },
  {
    name: 'mint-authority COption tag',
    fault: 'mint-option',
    error: 'SOLANA_ASSET_ACCOUNT_OPTION_TAG_INVALID',
  },
  {
    name: 'freeze-authority COption tag',
    fault: 'freeze-option',
    error: 'SOLANA_ASSET_ACCOUNT_OPTION_TAG_INVALID',
  },
] as const;
