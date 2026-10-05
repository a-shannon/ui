import { PublicKey, type Transaction } from '@solana/web3.js';

import {
  captureSolanaLockProfile,
  createSolanaRpcFeeProducers,
  createSolanaRpcTransport,
  createSolanaRpcWalletReadProducer,
  SOLANA_SPL_PROGRAM_ID,
  SOLANA_SYSTEM_PROGRAM_ID,
  type SolanaLockProfile,
} from '@rosen-network/solana';

import {
  createEventBoundSolanaWalletPort,
  type LegacySolanaEventProvider,
  prepareSolanaLockFeeQuote,
  type SolanaLockFeeIntent,
  type SolanaLockFeeOptions,
  type SolanaLockFeeQuote,
  type SolanaWalletSession,
} from '../src/index';
import { ergoDestination } from './testData';

const RPC_ENDPOINT = 'https://rpc.example.invalid/wallet-fee-join';
const MAX_REQUEST_BYTES = 8_192;
const MAX_RESPONSE_BYTES = 65_536;
const MAX_REQUEST_COUNT = 32;

export type RpcWalletFeeJoinKind = 'native' | 'spl';

/** Overrides only deterministic local balances, response contexts and captured fee policy. */
export interface RpcWalletFeeJoinOverrides {
  readonly balanceContextSlot?: bigint;
  readonly tokenContextSlot?: bigint;
  readonly mintContextSlot?: bigint;
  readonly blockhashContextSlot?: bigint;
  readonly feePayerContextSlot?: bigint;
  readonly messageFeeContextSlot?: bigint;
  readonly messageFeeLamports?: bigint | null;
  readonly tokenAmounts?: readonly bigint[];
  readonly grossAmount?: string;
  readonly minimumGrossAmount?: string;
  readonly networkFee?: string;
  readonly bridgeFee?: string;
}

export interface RpcWalletFeeJoinRequest {
  readonly method: string;
  readonly params: readonly unknown[];
  readonly body: string;
}

export interface RpcWalletFeeJoinHarness {
  readonly profile: SolanaLockProfile;
  readonly session: SolanaWalletSession;
  readonly intent: SolanaLockFeeIntent;
  readonly options: SolanaLockFeeOptions;
  readonly requests: readonly RpcWalletFeeJoinRequest[];
  readonly wallet: {
    readonly connectCalls: number;
    readonly signCalls: number;
    readonly activeListeners: number;
  };
  readonly walletReadResults: readonly unknown[];
  readonly endpointURL: string;
  readonly prepareQuote: () => Promise<SolanaLockFeeQuote>;
  readonly dispose: () => void;
}

interface TokenFixture {
  readonly address: string;
  readonly mint: string;
  readonly amount: bigint;
}

interface RpcWireRequest {
  readonly id?: unknown;
  readonly jsonrpc?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
}

/** Makes deterministic public keys from public fixture bytes; no keypair or secret is created. */
const publicKeyForFixture = (index: number): PublicKey => {
  const bytes = new Uint8Array(32);
  new DataView(bytes.buffer).setUint32(28, index, false);
  return new PublicKey(bytes);
};

/** Encodes bounded account bytes with browser and Node standard Base64 support. */
const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

/** Encodes one initialized original-SPL mint account without Node Buffer. */
const mintAccountJson = (decimals: number): string => {
  const bytes = new Uint8Array(82);
  new DataView(bytes.buffer).setBigUint64(36, 0n, true);
  bytes[44] = decimals;
  bytes[45] = 1;
  return JSON.stringify({
    data: [toBase64(bytes), 'base64'],
    executable: false,
    lamports: 1,
    owner: SOLANA_SPL_PROGRAM_ID,
    rentEpoch: 0,
    space: 82,
  });
};

/** Encodes one fully initialized original-SPL token account owned by the captured wallet. */
const tokenAccountJson = (token: TokenFixture, walletAddress: string): string => {
  const bytes = new Uint8Array(165);
  bytes.set(new PublicKey(token.mint).toBytes(), 0);
  bytes.set(new PublicKey(walletAddress).toBytes(), 32);
  new DataView(bytes.buffer).setBigUint64(64, token.amount, true);
  bytes[108] = 1;
  return JSON.stringify({
    data: [toBase64(bytes), 'base64'],
    executable: false,
    lamports: 1,
    owner: SOLANA_SPL_PROGRAM_ID,
    rentEpoch: 0,
    space: 165,
  });
};

/** Creates an event-capable sign-only synthetic wallet and exposes lifecycle counters. */
const createSyntheticWallet = (walletAddress: string) => {
  const listeners = new Map<'accountChanged' | 'disconnect', Set<() => void>>();
  let connected = false;
  let connectCalls = 0;
  let signCalls = 0;
  const countListeners = () =>
    Array.from(listeners.values()).reduce((total, group) => total + group.size, 0);
  let provider: LegacySolanaEventProvider;
  provider = {
    publicKey: new PublicKey(walletAddress),
    get isConnected() {
      return connected;
    },
    connect: async () => {
      connectCalls += 1;
      connected = true;
      return { publicKey: provider.publicKey as PublicKey };
    },
    disconnect: async () => {
      connected = false;
    },
    signTransaction: async (transaction: Transaction) => {
      signCalls += 1;
      return transaction;
    },
    on: (event, listener) => {
      const group = listeners.get(event) ?? new Set<() => void>();
      group.add(listener);
      listeners.set(event, group);
    },
    off: (event, listener) => {
      listeners.get(event)?.delete(listener);
    },
  };
  return {
    provider,
    counters: Object.freeze({
      get connectCalls() {
        return connectCalls;
      },
      get signCalls() {
        return signCalls;
      },
      get activeListeners() {
        return countListeners();
      },
    }),
  };
};

/** Builds one all-real wallet/read/fee quote path over an injected bounded RPC transcript. */
export const createRpcWalletFeeJoinHarness = async (
  kind: RpcWalletFeeJoinKind,
  overrides: RpcWalletFeeJoinOverrides = {},
): Promise<RpcWalletFeeJoinHarness> => {
  const walletAddress = publicKeyForFixture(1).toBase58();
  const syntheticWallet = createSyntheticWallet(walletAddress);
  const walletPort = createEventBoundSolanaWalletPort(() => syntheticWallet.provider);
  try {
    await walletPort.connect();
  } catch (error) {
    walletPort.dispose();
    throw error;
  }
  const session = walletPort.captureSession();
  const mint = publicKeyForFixture(2).toBase58();
  const selectedTokenAccount = publicKeyForFixture(3).toBase58();
  const tokenAmounts = kind === 'spl' ? (overrides.tokenAmounts ?? [10_000n]) : [];
  if (tokenAmounts.length > 2 || tokenAmounts.some((amount) => amount < 0n)) {
    walletPort.dispose();
    throw new RangeError('Synthetic wallet fixture supports at most two nonnegative balances');
  }
  if (kind === 'native' && overrides.tokenAmounts !== undefined) {
    walletPort.dispose();
    throw new TypeError('Native wallet fixture cannot include SPL token amounts');
  }
  const tokens: readonly TokenFixture[] = tokenAmounts.map((amount, index) => ({
    address: index === 0 ? selectedTokenAccount : publicKeyForFixture(4).toBase58(),
    mint,
    amount,
  }));
  const clusterGenesisHash = publicKeyForFixture(10).toBase58();
  const vaultOwner = publicKeyForFixture(11).toBase58();
  const vaultTokenAccount = publicKeyForFixture(12).toBase58();
  const asset = kind === 'native' ? 'SOL' : mint;
  const minimumGrossAmount = overrides.minimumGrossAmount ?? '1000';
  const assets = {
    [asset]: {
      kind,
      sourceDecimals: kind === 'native' ? 9 : 6,
      destinationDecimals: kind === 'native' ? 9 : 6,
      destinationTokenId: kind === 'native' ? 'cd'.repeat(32) : 'ab'.repeat(32),
      minimumGrossAmount,
      maximumGrossAmount: '10000000',
      networkFee: overrides.networkFee ?? '100',
      bridgeFee: overrides.bridgeFee ?? '200',
      ...(kind === 'spl' ? { vaultTokenAccount } : {}),
    },
  } as const;
  const profile = captureSolanaLockProfile({
    clusterGenesisHash,
    destinationNetwork: 'mainnet',
    vaultOwner,
    memoVersion: 1,
    assets,
  });
  const intent: SolanaLockFeeIntent = {
    asset,
    grossAmount: overrides.grossAmount ?? '1000',
    destinationAddress: ergoDestination,
    ...(kind === 'spl' ? { sourceTokenAccount: selectedTokenAccount } : {}),
  };
  const options: SolanaLockFeeOptions = Object.freeze({
    minimumNativeRemainder: 5n,
    minimumRemainingBlocks: 1n,
  });
  const tokenContextSlot = overrides.tokenContextSlot ?? 20n;
  const tokensRaw = `[${tokens
    .map(
      (token) =>
        `{"pubkey":${JSON.stringify(token.address)},"account":${tokenAccountJson(token, walletAddress)}}`,
    )
    .join(',')}]`;
  const requests: RpcWalletFeeJoinRequest[] = [];
  const walletReadResults: unknown[] = [];
  const endpointURL = RPC_ENDPOINT;
  /** Validates bounded synthetic RPC requests and returns method-specific wallet/fee fixture responses. */
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url !== endpointURL || init?.method !== 'POST' || typeof init.body !== 'string')
      throw new Error('Synthetic RPC fetch contract was violated');
    if (requests.length >= MAX_REQUEST_COUNT)
      throw new Error('Synthetic RPC request count exceeded its limit');
    if (new TextEncoder().encode(init.body).byteLength > MAX_REQUEST_BYTES)
      throw new Error('Synthetic RPC request body exceeded its limit');
    const wire = JSON.parse(init.body) as RpcWireRequest;
    if (
      wire.jsonrpc !== '2.0' ||
      !Number.isSafeInteger(wire.id) ||
      typeof wire.method !== 'string' ||
      !Array.isArray(wire.params)
    )
      throw new Error('Synthetic RPC request envelope is invalid');
    const id = wire.id as number;
    const method = wire.method;
    const params = wire.params as readonly unknown[];
    requests.push(Object.freeze({ method, params, body: init.body }));

    let rawResult: string;
    switch (method) {
      case 'getGenesisHash':
        rawResult = JSON.stringify(clusterGenesisHash);
        break;
      case 'getBalance':
        rawResult = `{"context":{"slot":${overrides.balanceContextSlot ?? 20n}},"value":90000000}`;
        break;
      case 'getTokenAccountsByOwner':
        rawResult = `{"context":{"slot":${tokenContextSlot}},"value":${tokensRaw}}`;
        break;
      case 'getMultipleAccounts': {
        const requestedMints = params[0];
        if (
          kind !== 'spl' ||
          !Array.isArray(requestedMints) ||
          requestedMints.some((requested) => requested !== mint)
        )
          throw new Error('Synthetic mint request did not match the captured SPL asset');
        const values = requestedMints.map(() => mintAccountJson(6)).join(',');
        rawResult = `{"context":{"slot":${overrides.mintContextSlot ?? tokenContextSlot}},"value":[${values}]}`;
        break;
      }
      case 'getLatestBlockhash':
        rawResult = `{"context":{"slot":${overrides.blockhashContextSlot ?? 21n}},"value":{"blockhash":"${publicKeyForFixture(13).toBase58()}","lastValidBlockHeight":200}}`;
        break;
      case 'getAccountInfo':
        rawResult = `{"context":{"slot":${overrides.feePayerContextSlot ?? 22n}},"value":{"data":["","base64"],"executable":false,"lamports":90000000,"owner":${JSON.stringify(SOLANA_SYSTEM_PROGRAM_ID)},"rentEpoch":0,"space":0}}`;
        break;
      case 'getMinimumBalanceForRentExemption':
        rawResult = '11';
        break;
      case 'getFeeForMessage':
        rawResult = `{"context":{"slot":${overrides.messageFeeContextSlot ?? 23n}},"value":${overrides.messageFeeLamports === null ? 'null' : (overrides.messageFeeLamports ?? 7n).toString()}}`;
        break;
      case 'getBlockHeight':
        rawResult = '190';
        break;
      default:
        throw new Error(`Unexpected synthetic RPC method: ${method}`);
    }
    const responseBody = `{"jsonrpc":"2.0","id":${id},"result":${rawResult}}`;
    if (new TextEncoder().encode(responseBody).byteLength > MAX_RESPONSE_BYTES)
      throw new Error('Synthetic RPC response body exceeded its limit');
    return new Response(responseBody, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const transport = createSolanaRpcTransport({
    endpointURL,
    timeoutMs: 1000,
    maxRequestBytes: MAX_REQUEST_BYTES,
    maxResponseBytes: MAX_RESPONSE_BYTES,
    fetchImpl,
  });
  const walletRead = createSolanaRpcWalletReadProducer({
    expectedGenesisHash: clusterGenesisHash,
    transport,
  });
  const observedWalletRead = async (
    request: Parameters<typeof walletRead>[0],
  ): Promise<unknown> => {
    const result = await walletRead(request);
    walletReadResults.push(result);
    return result;
  };
  const producers = createSolanaRpcFeeProducers({
    expectedGenesisHash: clusterGenesisHash,
    transport,
    readBalance: observedWalletRead,
  });

  return Object.freeze({
    profile,
    session,
    intent,
    options,
    requests,
    wallet: syntheticWallet.counters,
    walletReadResults,
    endpointURL,
    prepareQuote: () => prepareSolanaLockFeeQuote(profile, session, intent, producers, options),
    dispose: () => walletPort.dispose(),
  });
};
