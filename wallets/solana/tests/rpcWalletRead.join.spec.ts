import { describe, expect, it } from 'vitest';

import {
  createSolanaRpcTransport,
  createSolanaRpcWalletReadProducer,
  type SolanaWalletReadResult,
} from '@rosen-network/solana';

import { createEventBoundSolanaWalletPort } from '../src/eventBoundWalletPort';
import { prepareSolanaLockFeeQuote } from '../src/feeQuote';
import { createFeeQuoteFixture } from './feeQuoteTestUtils';
import { mockEventSolanaProvider } from './mocked/eventBoundWalletPort.mock';
import {
  WALLET_READ_FLOOR,
  WALLET_READ_OTHER_AMOUNT,
  WALLET_READ_SELECTED_AMOUNT,
} from './rpcWalletReadTestData';
import {
  type WalletReadTokenFixture,
  walletReadAccountJson,
  walletReadInventoryRaw,
  walletReadMintBase64,
  walletReadRpcResponse,
} from './rpcWalletReadTestUtils';
import { captureTestProfile, ergoDestination, keypair } from './testUtils';

describe('createSolanaRpcWalletReadProducer consumer join', () => {
  /**
   * @target readSolanaWalletBalance and selectSolanaSourceTokenAccount does not aggregate same-mint accounts before explicit source-account selection
   * @dependencies one actual event-bound wallet session, raw RPC producer, and captured SPL fee policy
   * @scenario expose balances 50 and 500 for the same mint, then select the first account for gross 100
   * @expected inventory remains unaggregated and the quote rejects the selected account's insufficient amount
   */
  it('does not aggregate same-mint accounts before explicit source-account selection', async () => {
    const wallet = mockEventSolanaProvider(keypair(1));
    const port = createEventBoundSolanaWalletPort(() => wallet.provider);
    await port.connect();
    try {
      const session = port.captureSession();
      const mint = keypair(4).publicKey.toBase58();
      const selectedAddress = keypair(6).publicKey.toBase58();
      const otherAddress = keypair(8).publicKey.toBase58();
      const profile = captureTestProfile({
        [mint]: {
          kind: 'spl',
          sourceDecimals: 6,
          destinationDecimals: 6,
          destinationTokenId: 'ab'.repeat(32),
          minimumGrossAmount: '100',
          maximumGrossAmount: '100000',
          networkFee: '1',
          bridgeFee: '1',
          vaultTokenAccount: keypair(10).publicKey.toBase58(),
        },
      });
      const local = createFeeQuoteFixture('native', session);
      const inventoryFixture: WalletReadTokenFixture[] = [
        {
          address: selectedAddress,
          mint,
          amount: WALLET_READ_SELECTED_AMOUNT,
          decimals: 6,
        },
        {
          address: otherAddress,
          mint,
          amount: WALLET_READ_OTHER_AMOUNT,
          decimals: 6,
        },
      ];
      const requestBodies: string[] = [];
      const rawResults: Record<string, string> = {
        getGenesisHash: JSON.stringify(profile.clusterGenesisHash),
        getBalance: `{"context":{"slot":${WALLET_READ_FLOOR + 5n}},"value":9007199254740993}`,
        getTokenAccountsByOwner: `{"context":{"slot":${WALLET_READ_FLOOR + 5n}},"value":${walletReadInventoryRaw(inventoryFixture, session.publicKey)}}`,
        getMultipleAccounts: `{"context":{"slot":${WALLET_READ_FLOOR + 5n}},"value":[${walletReadAccountJson(walletReadMintBase64(6))}]}`,
      };
      const fetchImpl: typeof fetch = async (_input, init) => {
        if (typeof init?.body !== 'string') throw new Error('Expected serialized request body');
        const body = init.body;
        requestBodies.push(body);
        const method = /"method":"([^"]+)"/u.exec(body)?.[1];
        const id = /"id":([1-9][0-9]*)/u.exec(body)?.[1];
        if (!method || !id || !Object.hasOwn(rawResults, method))
          throw new Error('Unexpected synthetic wallet-read request');
        return new Response(walletReadRpcResponse(Number(id), rawResults[method]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      };
      const transport = createSolanaRpcTransport({
        endpointURL: 'https://rpc.example.invalid/wallet-read-fixture',
        timeoutMs: 1000,
        maxRequestBytes: 1_048_576,
        maxResponseBytes: 1_048_576,
        fetchImpl,
      });
      const readBalance = createSolanaRpcWalletReadProducer({
        expectedGenesisHash: profile.clusterGenesisHash,
        transport,
      });
      const readRequest = {
        address: session.publicKey,
        clusterGenesisHash: profile.clusterGenesisHash,
        commitment: 'finalized',
        minContextSlot: WALLET_READ_FLOOR,
      } as const;
      local.blockhash.contextSlot = WALLET_READ_FLOOR + 5n;
      local.payer.contextSlot = WALLET_READ_FLOOR + 5n;
      local.fee.contextSlot = WALLET_READ_FLOOR + 5n;
      const inventory = (await readBalance(readRequest)) as SolanaWalletReadResult;
      expect(inventory.tokenAccounts.map((account) => account.amount)).toEqual([
        WALLET_READ_SELECTED_AMOUNT,
        WALLET_READ_OTHER_AMOUNT,
      ]);
      const intent = {
        asset: mint,
        grossAmount: '100',
        destinationAddress: ergoDestination,
        sourceTokenAccount: selectedAddress,
      };
      const producers = { ...local.producers, readBalance };
      await expect(
        prepareSolanaLockFeeQuote(profile, session, intent, producers, local.options),
      ).rejects.toThrow('Insufficient selected SPL account balance');
      expect(inventory.tokenAccounts.reduce((sum, account) => sum + account.amount, 0n)).toEqual(
        WALLET_READ_SELECTED_AMOUNT + WALLET_READ_OTHER_AMOUNT,
      );
      expect(requestBodies.some((body) => body.includes('"method":"getMultipleAccounts"'))).toEqual(
        true,
      );
      expect(requestBodies.every((body) => body.includes('"jsonrpc":"2.0"'))).toEqual(true);
    } finally {
      port.dispose();
    }
  });
});
