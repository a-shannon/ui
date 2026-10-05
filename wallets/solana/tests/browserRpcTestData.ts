import type { RpcWalletFeeJoinOverrides } from './rpcWalletFeeTestUtils';

/** Browser consumer refusals for insufficient selected-token balance and invalid wallet-read context or fee data. */
export const browserRpcRefusals: readonly {
  readonly name: string;
  readonly kind: 'native' | 'spl';
  readonly overrides: RpcWalletFeeJoinOverrides;
  readonly error: string;
}[] = [
  {
    name: 'selected-account',
    kind: 'spl',
    overrides: {
      tokenAmounts: [50n, 500n],
      grossAmount: '100',
      minimumGrossAmount: '3',
      networkFee: '1',
      bridgeFee: '1',
    },
    error: 'Insufficient selected SPL account balance',
  },
  {
    name: 'inventory-context',
    kind: 'native',
    overrides: { tokenContextSlot: 19n },
    error: 'SOLANA_RPC_WALLET_READ_CONTEXT_SLOT_MISMATCH',
  },
  {
    name: 'null-fee',
    kind: 'native',
    overrides: { messageFeeLamports: null },
    error: 'Message fee is unavailable',
  },
  {
    name: 'fee-floor',
    kind: 'native',
    overrides: { messageFeeContextSlot: 21n },
    error: 'SOLANA_RPC_CONTEXT_BELOW_FLOOR',
  },
];
