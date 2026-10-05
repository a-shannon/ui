import { browserRpcRefusals } from './browserRpcTestData';
import {
  createRpcWalletFeeJoinHarness,
  type RpcWalletFeeJoinHarness,
} from './rpcWalletFeeTestUtils';

/** Runs actual exported RPC/read/fee/quote composition through bounded synthetic Web API responses. */
export const runBrowserRpcChecks = async () => {
  let checks = 0;
  /** Compares one named primitive result so a failure identifies the deciding boundary. */
  const check = (name: string, actual: unknown, expected: unknown): void => {
    if (actual !== expected) throw new Error(`RPC_BROWSER_CHECK_FAILED:${name}`);
    checks += 1;
  };
  /** Reads one recorded contextual floor without changing its request. */
  const floor = (harness: RpcWalletFeeJoinHarness, method: string, index: number): unknown => {
    const found = harness.requests.find((request) => request.method === method);
    if (!found) throw new Error(`RPC_BROWSER_REQUEST_MISSING:${method}`);
    return (found.params[index] as { readonly minContextSlot?: unknown }).minContextSlot;
  };
  for (const kind of ['native', 'spl'] as const) {
    const harness = await createRpcWalletFeeJoinHarness(kind);
    try {
      check(`${kind}:connected`, harness.wallet.connectCalls, 1);
      check(`${kind}:listeners`, harness.wallet.activeListeners, 2);
      const quote = await harness.prepareQuote();
      check(`${kind}:fee`, quote.feeLamports, 7n);
      check(`${kind}:context`, quote.contextSlot, 23n);
      check(`${kind}:blockhash-floor`, floor(harness, 'getLatestBlockhash', 0), 20);
      check(`${kind}:payer-floor`, floor(harness, 'getAccountInfo', 1), 21);
      check(`${kind}:fee-floor`, floor(harness, 'getFeeForMessage', 1), 22);
      check(`${kind}:height-floor`, floor(harness, 'getBlockHeight', 0), 23);
      check(
        `${kind}:exact-message`,
        harness.requests.find((request) => request.method === 'getFeeForMessage')?.params[0],
        quote.messageBase64,
      );
      check(`${kind}:no-sign`, harness.wallet.signCalls, 0);
      if (kind === 'native') {
        check(
          'native:no-mint-read',
          harness.requests.filter((request) => request.method === 'getMultipleAccounts').length,
          0,
        );
      } else {
        const read = harness.walletReadResults[0] as {
          readonly tokenAccounts: readonly { readonly amount: bigint }[];
        };
        check(
          'spl:raw-selected-amount',
          read.tokenAccounts.map((account) => account.amount.toString()).join(','),
          '10000',
        );
        check('spl:mint-floor', floor(harness, 'getMultipleAccounts', 1), 20);
      }
    } finally {
      harness.dispose();
      check(`${kind}:handlers-removed`, harness.wallet.activeListeners, 0);
    }
  }
  for (const refusal of browserRpcRefusals) {
    const harness = await createRpcWalletFeeJoinHarness(refusal.kind, refusal.overrides);
    try {
      check(`${refusal.name}:connected`, harness.wallet.connectCalls, 1);
      let message: unknown;
      try {
        await harness.prepareQuote();
      } catch (error) {
        message = error instanceof Error ? error.message : undefined;
      }
      check(`${refusal.name}:exact-refusal`, message, refusal.error);
      check(`${refusal.name}:no-sign`, harness.wallet.signCalls, 0);
      if (refusal.name === 'selected-account') {
        const read = harness.walletReadResults[0] as {
          readonly tokenAccounts: readonly { readonly amount: bigint }[];
        };
        check(
          'selected-account:unaggregated-rows',
          read.tokenAccounts.map((account) => account.amount.toString()).join(','),
          '50,500',
        );
      } else if (refusal.name === 'inventory-context') {
        check('inventory-context:no-partial-read', harness.walletReadResults.length, 0);
      } else if (refusal.name === 'fee-floor') {
        check('fee-floor:requested-floor', floor(harness, 'getFeeForMessage', 1), 22);
      }
    } finally {
      harness.dispose();
      check(`${refusal.name}:handlers-removed`, harness.wallet.activeListeners, 0);
    }
  }
  return {
    checks,
    scenarios: 6,
    absentGlobals: {
      Buffer: typeof globalThis.Buffer,
      process: typeof globalThis.process,
      require: typeof globalThis.require,
    },
  };
};
