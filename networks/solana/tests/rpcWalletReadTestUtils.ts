import { Buffer } from 'buffer';

import { PublicKey } from '@solana/web3.js';
import { expect } from 'vitest';

import {
  createSolanaRpcWalletReadProducer,
  SOLANA_SPL_PROGRAM_ID,
  type SolanaRpcRequest,
  type SolanaRpcTransport,
} from '@rosen-network/solana';

import { WALLET_READ_FLOOR, WALLET_READ_ODD_U64, WALLET_READ_SLOT } from './rpcWalletReadTestData';

export interface WalletReadTokenFixture {
  readonly address: string;
  readonly mint: string;
  readonly amount: bigint;
  readonly decimals: number;
  readonly state?: 'initialized' | 'frozen';
  readonly nativeReserve?: bigint | null;
  readonly rawStateTag?: number;
}

export type WalletReadRpcMethod =
  | 'getGenesisHash'
  | 'getBalance'
  | 'getTokenAccountsByOwner'
  | 'getMultipleAccounts';

type FixtureOptions = {
  readonly genesisHash?: string;
  readonly genesisResults?: readonly (string | null)[];
  readonly walletAddress?: string;
  readonly tokenAccounts?: readonly WalletReadTokenFixture[];
  readonly balanceSlot?: string;
  readonly tokenSlot?: string;
  readonly mintSlots?: readonly string[];
  readonly nativeBalance?: string;
  readonly tokenInventoryRaw?: string;
  readonly mintValuesRaw?: (requestedMints: readonly string[], batchIndex: number) => string;
  readonly transportError?: (request: SolanaRpcRequest) => unknown;
  readonly beforeResponse?: (request: SolanaRpcRequest) => Promise<void> | void;
};

/** Generate canonical deterministic public keys without signing or account material. */
export const walletReadKey = (index: number): string => {
  const bytes = new Uint8Array(32);
  new DataView(bytes.buffer).setUint32(0, index + 1, false);
  return new PublicKey(bytes).toBase58();
};

/** Encode one fully initialized original-SPL mint byte layout for local RPC fixtures. */
export const walletReadMintBase64 = (decimals: number): string => {
  const bytes = Buffer.alloc(82);
  bytes.writeBigUInt64LE(0n, 36);
  bytes[44] = decimals;
  bytes[45] = 1;
  return bytes.toString('base64');
};

/** Encode a complete original-SPL token account with independently selected state. */
export const walletReadTokenAccountBase64 = (
  fixture: WalletReadTokenFixture,
  walletAddress: string,
): string => {
  const bytes = Buffer.alloc(165);
  new PublicKey(fixture.mint).toBuffer().copy(bytes, 0);
  new PublicKey(walletAddress).toBuffer().copy(bytes, 32);
  bytes.writeBigUInt64LE(fixture.amount, 64);
  bytes[108] = fixture.rawStateTag ?? (fixture.state === 'frozen' ? 2 : 1);
  if (fixture.nativeReserve !== undefined && fixture.nativeReserve !== null) {
    bytes.writeUInt32LE(1, 109);
    bytes.writeBigUInt64LE(fixture.nativeReserve, 113);
  }
  return bytes.toString('base64');
};

/** Render one complete getAccountInfo object with raw JSON integer fields. */
export const walletReadAccountJson = (dataBase64: string, owner = SOLANA_SPL_PROGRAM_ID): string =>
  `{"data":[${JSON.stringify(dataBase64)},"base64"],"executable":false,"lamports":1,"owner":${JSON.stringify(owner)},"rentEpoch":0,"space":165}`;

/** Build a correlated JSON-RPC response without parsing or rewriting result number lexemes. */
export const walletReadRpcResponse = (id: number, rawResult: string): string =>
  `{"jsonrpc":"2.0","id":${id},"result":${rawResult}}`;

/** Construct the default complete inventory row list, including full account metadata. */
export const walletReadInventoryRaw = (
  accounts: readonly WalletReadTokenFixture[],
  walletAddress: string,
): string =>
  `[${accounts
    .map(
      (account) =>
        `{"pubkey":${JSON.stringify(account.address)},"account":${walletReadAccountJson(walletReadTokenAccountBase64(account, walletAddress))}}`,
    )
    .join(',')}]`;

/** Construct an injected local transport and producer while recording immutable requests. */
export const createWalletReadFixture = (options: FixtureOptions = {}) => {
  const walletAddress = options.walletAddress ?? walletReadKey(9000);
  const genesisHash = options.genesisHash ?? walletReadKey(9001);
  const tokenAccounts = options.tokenAccounts ?? [];
  const requests: SolanaRpcRequest[] = [];
  const genesisResults = options.genesisResults ?? [genesisHash];
  const mintSlots = options.mintSlots ?? [WALLET_READ_SLOT.toString()];
  let genesisIndex = 0;
  let mintBatchIndex = 0;

  const transport: SolanaRpcTransport = async (request) => {
    requests.push(request);
    await options.beforeResponse?.(request);
    const error = options.transportError?.(request);
    if (error !== undefined) throw error;
    if (request.method === 'getGenesisHash') {
      const next = genesisResults[Math.min(genesisIndex, genesisResults.length - 1)];
      genesisIndex += 1;
      return walletReadRpcResponse(request.id, JSON.stringify(next ?? null));
    }
    if (request.method === 'getBalance') {
      return walletReadRpcResponse(
        request.id,
        `{"context":{"slot":${options.balanceSlot ?? WALLET_READ_SLOT.toString()}} ,"value":${options.nativeBalance ?? WALLET_READ_ODD_U64.toString()}}`,
      );
    }
    if (request.method === 'getTokenAccountsByOwner') {
      const value =
        options.tokenInventoryRaw ?? walletReadInventoryRaw(tokenAccounts, walletAddress);
      return walletReadRpcResponse(
        request.id,
        `{"context":{"slot":${options.tokenSlot ?? WALLET_READ_SLOT.toString()}},"value":${value}}`,
      );
    }
    if (request.method === 'getMultipleAccounts') {
      const batchIndex = mintBatchIndex;
      mintBatchIndex += 1;
      const requestedMints = request.params[0] as readonly string[];
      const value =
        options.mintValuesRaw?.(requestedMints, batchIndex) ??
        `[${requestedMints
          .map((mint) => {
            const decimals = tokenAccounts.find((account) => account.mint === mint)?.decimals ?? 6;
            return walletReadAccountJson(walletReadMintBase64(decimals));
          })
          .join(',')}]`;
      const slot = mintSlots[Math.min(batchIndex, mintSlots.length - 1)] ?? '0';
      return walletReadRpcResponse(request.id, `{"context":{"slot":${slot}},"value":${value}}`);
    }
    throw new Error(`Unexpected synthetic wallet-read RPC method: ${request.method}`);
  };

  const producer = createSolanaRpcWalletReadProducer({
    expectedGenesisHash: genesisHash,
    transport,
  });
  const request = Object.freeze({
    address: walletAddress,
    clusterGenesisHash: genesisHash,
    commitment: 'finalized' as const,
    minContextSlot: WALLET_READ_FLOOR,
  });
  return { producer, requests, request, walletAddress, genesisHash, tokenAccounts, transport };
};

/** Assert one exact failure code from an async producer operation. */
export const expectWalletReadError = async (action: () => Promise<unknown>, code: string) => {
  let caught: unknown;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toEqual(code);
};
