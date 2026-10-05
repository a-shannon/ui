import { PublicKey } from '@solana/web3.js';

import type { SolanaLockFeeProducers } from './feeQuote';
import { SOLANA_SPL_PROGRAM_ID, SOLANA_U64_MAX } from './lockProfile';
import type { SolanaWalletReadResult, SolanaWalletTokenAccount } from './readPort';
import { decodeSolanaRpcMint, decodeSolanaRpcTokenAccount } from './rpcAccountDecoder';
import {
  createRpcCaller,
  type JsonNode,
  member,
  type ObjectNode,
  readU64Value,
  type SolanaRpcTransport,
  stringValue,
} from './rpcProtocol';

/** Structural row-count cap; parser and transport byte limits may refuse smaller inventories first. */
const MAX_TOKEN_ACCOUNTS = 4096;
const MAX_MULTIPLE_ACCOUNTS = 100;
const FINALIZED = 'finalized' as const;

export interface SolanaRpcWalletReadOptions {
  readonly expectedGenesisHash: string;
  readonly transport: SolanaRpcTransport;
}

type DataRecord = Record<string, unknown>;

/** Throw one stable producer failure code without attaching request or endpoint data. */
const fail = (code: string): never => {
  throw new Error(code);
};

/** Capture one exact plain own-data record without invoking accessors or retaining its object. */
const ownDataRecord = (value: unknown, fields: readonly string[], code: string): DataRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail(code);
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== 'string' || !fields.includes(key))
  )
    return fail(code);
  const captured: DataRecord = {};
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)
      return fail(code);
    captured[field] = descriptor.value;
  }
  return captured;
};

/** Require a canonical Solana public key string without coercion. */
const canonicalKey = (value: unknown, code: string): string => {
  if (typeof value !== 'string') return fail(code);
  try {
    if (new PublicKey(value).toBase58() !== value) return fail(code);
    return value;
  } catch {
    return fail(code);
  }
};

/** Require one caller-supplied raw bigint floor within the unsigned 64-bit range. */
const requestU64 = (value: unknown): bigint => {
  if (typeof value !== 'bigint' || value < 0n || value > SOLANA_U64_MAX)
    return fail('SOLANA_RPC_WALLET_READ_REQUEST_INVALID');
  return value;
};

/** Require an AST object with exactly its required and explicitly optional fields. */
const exactObject = (
  node: JsonNode | undefined,
  required: readonly string[],
  optional: readonly string[] = [],
  code = 'SOLANA_RPC_WALLET_READ_RESPONSE_INVALID',
): ObjectNode => {
  if (node?.kind !== 'object') return fail(code);
  const keys = [...node.members.keys()];
  if (
    keys.length < required.length ||
    keys.length > required.length + optional.length ||
    required.some((key) => !node.members.has(key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  )
    return fail(code);
  return node;
};

/** Read one response context and preserve its exact unsigned slot. */
const readContextSlot = (node: JsonNode | undefined, floor: bigint): bigint => {
  const context = exactObject(
    node,
    ['slot'],
    ['apiVersion'],
    'SOLANA_RPC_WALLET_READ_CONTEXT_INVALID',
  );
  if (context.members.has('apiVersion') && stringValue(member(context, 'apiVersion')) === undefined)
    return fail('SOLANA_RPC_WALLET_READ_CONTEXT_INVALID');
  const slot = readU64Value(member(context, 'slot'));
  if (slot < floor) return fail('SOLANA_RPC_WALLET_READ_CONTEXT_BELOW_FLOOR');
  return slot;
};

/** Require the finalized context/value shell returned by context-bearing methods. */
const contextualValue = (
  result: JsonNode,
  floor: bigint,
): { readonly slot: bigint; readonly value: JsonNode } => {
  const contextual = exactObject(result, ['context', 'value']);
  const slot = readContextSlot(member(contextual, 'context'), floor);
  const value = member(contextual, 'value');
  if (!value) return fail('SOLANA_RPC_WALLET_READ_RESPONSE_INVALID');
  return { slot, value };
};

/** Validate all RPC account metadata and provide only the decoder's selected fields. */
const selectedAccount = (
  value: JsonNode,
): {
  readonly owner: string;
  readonly executable: boolean;
  readonly data: readonly [string, 'base64'];
} => {
  const account = exactObject(
    value,
    ['data', 'executable', 'lamports', 'owner', 'rentEpoch'],
    ['space'],
    'SOLANA_RPC_WALLET_READ_ACCOUNT_INVALID',
  );
  const owner = canonicalKey(
    stringValue(member(account, 'owner')),
    'SOLANA_RPC_WALLET_READ_ACCOUNT_INVALID',
  );
  const executable = member(account, 'executable');
  if (executable?.kind !== 'atom' || typeof executable.value !== 'boolean')
    return fail('SOLANA_RPC_WALLET_READ_ACCOUNT_INVALID');
  readU64Value(member(account, 'lamports'));
  readU64Value(member(account, 'rentEpoch'));
  if (account.members.has('space')) readU64Value(member(account, 'space'));
  const data = member(account, 'data');
  if (data?.kind !== 'array' || data.items.length !== 2)
    return fail('SOLANA_RPC_WALLET_READ_ACCOUNT_INVALID');
  const encoded = stringValue(data.items[0]);
  if (encoded === undefined || stringValue(data.items[1]) !== 'base64')
    return fail('SOLANA_RPC_WALLET_READ_ACCOUNT_INVALID');
  return { owner, executable: executable.value, data: [encoded, 'base64'] };
};

/** Read the configured genesis identity and fail closed on malformed or different clusters. */
const observeGenesis = async (
  call: ReturnType<typeof createRpcCaller>,
  expectedGenesisHash: string,
): Promise<void> => {
  const { result } = await call('getGenesisHash', []);
  const observed = canonicalKey(stringValue(result), 'SOLANA_RPC_WALLET_READ_GENESIS_INVALID');
  if (observed !== expectedGenesisHash) fail('SOLANA_RPC_WALLET_READ_GENESIS_MISMATCH');
};

/** Preserve the data-read error while still making the final cluster check. */
const withGenesisSandwich = async <T>(
  call: ReturnType<typeof createRpcCaller>,
  expectedGenesisHash: string,
  read: () => Promise<T>,
): Promise<T> => {
  await observeGenesis(call, expectedGenesisHash);
  let value: T | undefined;
  let readFailed = false;
  let readError: unknown;
  try {
    value = await read();
  } catch (error) {
    readFailed = true;
    readError = error;
  }
  try {
    await observeGenesis(call, expectedGenesisHash);
  } catch (error) {
    if (!readFailed) throw error;
  }
  if (readFailed) throw readError;
  return value as T;
};

/** Parse every token-account row, reject duplicate addresses, and fully decode its 165 bytes. */
const readTokenInventory = (
  node: JsonNode,
  address: string,
): readonly ReturnType<typeof decodeSolanaRpcTokenAccount>[] => {
  if (node.kind !== 'array') return fail('SOLANA_RPC_WALLET_READ_INVENTORY_INVALID');
  if (node.items.length > MAX_TOKEN_ACCOUNTS) return fail('SOLANA_RPC_WALLET_READ_INVENTORY_LIMIT');
  const seen = new Set<string>();
  const accounts = node.items.map((item) => {
    const entry = exactObject(
      item,
      ['account', 'pubkey'],
      [],
      'SOLANA_RPC_WALLET_READ_ACCOUNT_INVALID',
    );
    const pubkey = canonicalKey(
      stringValue(member(entry, 'pubkey')),
      'SOLANA_RPC_WALLET_READ_ACCOUNT_INVALID',
    );
    if (seen.has(pubkey)) return fail('SOLANA_RPC_WALLET_READ_DUPLICATE_ACCOUNT');
    seen.add(pubkey);
    const account = selectedAccount(member(entry, 'account') as JsonNode);
    return decodeSolanaRpcTokenAccount(pubkey, account, address);
  });
  return Object.freeze(accounts);
};

/** Decode the complete mint response in request order and bind each decimals value to its key. */
const readMintBatch = (
  node: JsonNode,
  requestedMints: readonly string[],
): ReadonlyMap<string, number> => {
  if (node.kind !== 'array' || node.items.length !== requestedMints.length)
    return fail('SOLANA_RPC_WALLET_READ_MINT_RESPONSE_INVALID');
  const decimals = new Map<string, number>();
  for (const [index, item] of node.items.entries()) {
    if (item.kind === 'atom' && item.value === null)
      return fail('SOLANA_RPC_WALLET_READ_MINT_UNAVAILABLE');
    const account = selectedAccount(item);
    const mint = decodeSolanaRpcMint(requestedMints[index], account);
    if (decimals.has(mint.address)) return fail('SOLANA_RPC_WALLET_READ_MINT_RESPONSE_INVALID');
    decimals.set(mint.address, mint.decimals);
  }
  return decimals;
};

/** Read raw SOL and complete original-SPL inventory through one unauthenticated RPC transport. */
export const createSolanaRpcWalletReadProducer = (
  options: SolanaRpcWalletReadOptions,
): SolanaLockFeeProducers['readBalance'] => {
  const config = ownDataRecord(
    options,
    ['expectedGenesisHash', 'transport'],
    'SOLANA_RPC_WALLET_READ_CONFIG_INVALID',
  );
  const expectedGenesisHash = canonicalKey(
    config.expectedGenesisHash,
    'SOLANA_RPC_WALLET_READ_CONFIG_INVALID',
  );
  if (typeof config.transport !== 'function') return fail('SOLANA_RPC_WALLET_READ_CONFIG_INVALID');
  const transport = config.transport as SolanaRpcTransport;
  const call = createRpcCaller(transport);

  return async (request) => {
    const captured = ownDataRecord(
      request,
      ['address', 'clusterGenesisHash', 'commitment', 'minContextSlot'],
      'SOLANA_RPC_WALLET_READ_REQUEST_INVALID',
    );
    const address = canonicalKey(captured.address, 'SOLANA_RPC_WALLET_READ_REQUEST_INVALID');
    const genesisHash = canonicalKey(
      captured.clusterGenesisHash,
      'SOLANA_RPC_WALLET_READ_REQUEST_INVALID',
    );
    if (genesisHash !== expectedGenesisHash) fail('SOLANA_RPC_WALLET_READ_GENESIS_MISMATCH');
    if (captured.commitment !== FINALIZED) fail('SOLANA_RPC_WALLET_READ_REQUEST_INVALID');
    const minContextSlot = requestU64(captured.minContextSlot);
    const capturedRequest = Object.freeze({
      address,
      clusterGenesisHash: expectedGenesisHash,
      commitment: FINALIZED,
      minContextSlot,
    });

    return withGenesisSandwich(call, expectedGenesisHash, async () => {
      const balanceResponse = await call('getBalance', [
        address,
        Object.freeze({ commitment: FINALIZED, minContextSlot }),
      ]);
      const balance = contextualValue(balanceResponse.result, minContextSlot);
      const nativeBalance = readU64Value(balance.value);

      const tokenResponse = await call('getTokenAccountsByOwner', [
        address,
        Object.freeze({ programId: SOLANA_SPL_PROGRAM_ID }),
        Object.freeze({ commitment: FINALIZED, encoding: 'base64', minContextSlot }),
      ]);
      const tokenResult = contextualValue(tokenResponse.result, minContextSlot);
      if (tokenResult.slot !== balance.slot) fail('SOLANA_RPC_WALLET_READ_CONTEXT_SLOT_MISMATCH');
      const decoded = readTokenInventory(tokenResult.value, capturedRequest.address);
      const uniqueMints = Object.freeze([...new Set(decoded.map((account) => account.mint))]);
      const mintDecimals = new Map<string, number>();

      for (let start = 0; start < uniqueMints.length; start += MAX_MULTIPLE_ACCOUNTS) {
        const batch = Object.freeze(uniqueMints.slice(start, start + MAX_MULTIPLE_ACCOUNTS));
        const mintResponse = await call('getMultipleAccounts', [
          batch,
          Object.freeze({
            commitment: FINALIZED,
            encoding: 'base64',
            minContextSlot: tokenResult.slot,
          }),
        ]);
        const contextual = contextualValue(mintResponse.result, tokenResult.slot);
        if (contextual.slot !== tokenResult.slot)
          fail('SOLANA_RPC_WALLET_READ_MINT_CONTEXT_SLOT_MISMATCH');
        for (const [mint, decimals] of readMintBatch(contextual.value, batch))
          mintDecimals.set(mint, decimals);
      }

      const tokenAccounts: readonly SolanaWalletTokenAccount[] = Object.freeze(
        decoded.map((account) => {
          const decimals = mintDecimals.get(account.mint);
          if (decimals === undefined) return fail('SOLANA_RPC_WALLET_READ_MINT_UNAVAILABLE');
          return Object.freeze({
            address: account.address,
            mint: account.mint,
            programId: SOLANA_SPL_PROGRAM_ID,
            owner: account.owner,
            amount: account.amount,
            decimals,
            state: account.state,
          });
        }),
      );
      const result: SolanaWalletReadResult = Object.freeze({
        address: capturedRequest.address,
        clusterGenesisHash: expectedGenesisHash,
        commitment: FINALIZED,
        nativeContextSlot: balance.slot,
        tokenContextSlot: tokenResult.slot,
        nativeBalance,
        tokenAccounts,
      });
      return result;
    });
  };
};
