import { expect } from 'vitest';

import type {
  SolanaLockFeeProducers,
  SolanaRpcRequest,
  SolanaRpcTransport,
} from '@rosen-network/solana';
import {
  createSolanaRpcFeeProducers,
  type SolanaRpcFeeProducerOptions,
} from '@rosen-network/solana';

import {
  EXPECTED_GENESIS_HASH,
  MIN_CONTEXT_SLOT,
  TEST_ADDRESS,
  TEST_BLOCKHASH,
  U64_MAX,
} from './rpcFeeProducersTestData';

type RpcMethod =
  | 'getGenesisHash'
  | 'getLatestBlockhash'
  | 'getAccountInfo'
  | 'getMinimumBalanceForRentExemption'
  | 'getFeeForMessage'
  | 'getBlockHeight';

type FixtureOptions = {
  readonly expectedGenesisHash?: string;
  readonly genesisValues?: readonly string[];
  readonly resultOverrides?: Partial<Record<Exclude<RpcMethod, 'getGenesisHash'>, string>>;
  readonly responseOverride?: (request: SolanaRpcRequest) => string | undefined;
  readonly transportError?: (request: SolanaRpcRequest) => unknown;
  readonly beforeResponse?: (request: SolanaRpcRequest) => Promise<void> | void;
  readonly readBalance?: SolanaLockFeeProducers['readBalance'];
};

const DEFAULT_RESULTS: Record<Exclude<RpcMethod, 'getGenesisHash'>, string> = {
  getLatestBlockhash: `{"context":{"slot":${MIN_CONTEXT_SLOT},"apiVersion":"1.18.0"},"value":{"blockhash":"${TEST_BLOCKHASH}","lastValidBlockHeight":${U64_MAX}}}`,
  getAccountInfo: `{"context":{"slot":${MIN_CONTEXT_SLOT}},"value":{"data":["","base64"],"executable":false,"lamports":9007199254740993,"owner":"${TEST_ADDRESS}","rentEpoch":${U64_MAX},"space":0}}`,
  getMinimumBalanceForRentExemption: `${U64_MAX}`,
  getFeeForMessage: `{"context":{"slot":${MIN_CONTEXT_SLOT}},"value":0}`,
  getBlockHeight: '9007199254740993',
};

/** Builds one exact raw JSON-RPC envelope without converting result number lexemes. */
export const rpcResponse = (id: number, rawResult: string): string =>
  `{"jsonrpc":"2.0","id":${id},"result":${rawResult}}`;

/** Builds a contextual RPC result with an optional documented API version field. */
export const contextualResult = (slot: string, value: string, apiVersion?: string): string =>
  `{"context":{"slot":${slot}${apiVersion === undefined ? '' : `,"apiVersion":"${apiVersion}"`}},"value":${value}}`;

/** Constructs six producers over one deterministic injected transport and records every request. */
export const createFeeProducerFixture = (options: FixtureOptions = {}) => {
  const requests: SolanaRpcRequest[] = [];
  const balanceCalls: Parameters<SolanaLockFeeProducers['readBalance']>[0][] = [];
  const expectedGenesisHash = options.expectedGenesisHash ?? EXPECTED_GENESIS_HASH;
  const genesisValues = options.genesisValues ?? [expectedGenesisHash];
  let genesisIndex = 0;
  const readBalance =
    options.readBalance ??
    (async (request: Parameters<SolanaLockFeeProducers['readBalance']>[0]) => {
      balanceCalls.push(request);
      return { fixture: 'balance', address: request.address, floor: request.minContextSlot };
    });
  const transport: SolanaRpcTransport = async (request) => {
    requests.push(request);
    await options.beforeResponse?.(request);
    const thrown = options.transportError?.(request);
    if (thrown !== undefined) throw thrown;
    const responseOverride = options.responseOverride?.(request);
    if (responseOverride !== undefined) return responseOverride;
    if (request.method === 'getGenesisHash') {
      const index = Math.min(genesisIndex, genesisValues.length - 1);
      const observed = genesisValues[index] ?? EXPECTED_GENESIS_HASH;
      genesisIndex += 1;
      return rpcResponse(request.id, JSON.stringify(observed));
    }
    if (!(request.method in DEFAULT_RESULTS))
      throw new Error(`Unexpected local fixture method: ${request.method}`);
    const method = request.method as Exclude<RpcMethod, 'getGenesisHash'>;
    return rpcResponse(request.id, options.resultOverrides?.[method] ?? DEFAULT_RESULTS[method]);
  };
  const configuration: SolanaRpcFeeProducerOptions = {
    expectedGenesisHash,
    transport,
    readBalance,
  };
  const producers = createSolanaRpcFeeProducers(configuration);
  return { configuration, producers, requests, balanceCalls, transport };
};

/** Verifies exact stable failure codes from one asynchronous producer operation. */
export const expectProducerError = async (
  action: () => Promise<unknown>,
  code: string,
): Promise<void> => {
  let caught: unknown;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toEqual(code);
};
