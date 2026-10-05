/** Exact native and mint balances used to prove raw-u64 handling and boundaries. */
export const WALLET_READ_U64_MAX = 18_446_744_073_709_551_615n;
/** Native or token balance above Number.MAX_SAFE_INTEGER used to detect lossy conversion. */
export const WALLET_READ_ODD_U64 = 9_007_199_254_740_993n;
/** Minimum context slot supplied to wallet reads, kept distinct from returned slot fixtures. */
export const WALLET_READ_FLOOR = 9_007_199_254_740_990n;
/** Returned context slot above Number.MAX_SAFE_INTEGER used for exact bigint comparisons. */
export const WALLET_READ_SLOT = 9_007_199_254_740_995n;

/** Inventory bounds and SPL batching use one item beyond the configured batch size. */
export const WALLET_READ_MAX_ACCOUNTS = 4096;
/** Maximum number of mint accounts fetched in one batch. */
export const WALLET_READ_MINT_BATCH_SIZE = 100;
/** Inventory size used to cross the mint-fetch batch boundary by one account. */
export const WALLET_READ_BATCH_FALSIFIER_COUNT = 101;

/** Consumer join uses distinct balances for one mint and one explicit source account. */
export const WALLET_READ_SELECTED_AMOUNT = 50n;
/** Larger same-mint balance that must remain a separate source account in selection tests. */
export const WALLET_READ_OTHER_AMOUNT = 500n;
/** Gross transfer amount exceeding the selected account balance but below the combined inventory. */
export const WALLET_READ_JOIN_GROSS_AMOUNT = '100';
