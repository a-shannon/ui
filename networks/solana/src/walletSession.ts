/** Public wallet identity passed into a configured network quote/read service. */
export interface SolanaWalletSession {
  readonly publicKey: string;
}

/** Pair-local wallet currentness supplied as trusted service configuration. */
export type SolanaWalletSessionCurrentness = (value: unknown) => value is SolanaWalletSession;
