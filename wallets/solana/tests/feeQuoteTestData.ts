/** Plain synthetic fee, balance, reserve and height coordinates shared by quote fixtures. */
export const feeQuoteTestData: Readonly<{
  nativeBalance: bigint;
  payerLamports: bigint;
  feeLamports: bigint;
  rentMinimum: bigint;
  minimumNativeRemainder: bigint;
  minimumRemainingBlocks: bigint;
  lastValidBlockHeight: bigint;
  blockHeight: bigint;
  grossAmount: string;
}> = Object.freeze({
  nativeBalance: 2000n,
  payerLamports: 1900n,
  feeLamports: 7n,
  rentMinimum: 11n,
  minimumNativeRemainder: 5n,
  minimumRemainingBlocks: 1n,
  lastValidBlockHeight: 200n,
  blockHeight: 190n,
  grossAmount: '1000',
});
