import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Transaction } from '@solana/web3.js';
import bs58 from 'bs58';

import { SOLANA_SPL_PROGRAM_ID, type SolanaLockProfile } from '@rosen-network/solana';

import { keypair } from './testUtils';

/** RPC-shaped projection of a real signed compiled message with simulated history. */
export interface LockRpcFixture {
  clusterGenesisHash: string;
  destinationNetwork: string;
  commitment: string;
  slot: number;
  blockhash: string;
  version: string;
  transaction: {
    signatures: string[];
    message: {
      header: ReturnType<Transaction['compileMessage']>['header'];
      accountKeys: string[];
      recentBlockhash: string;
      instructions: ReturnType<Transaction['compileMessage']>['instructions'];
    };
  };
  meta: {
    err: null;
    fee: string;
    innerInstructions: unknown[];
    loadedAddresses: { writable: string[]; readonly: string[] };
    preBalances: string[];
    postBalances: string[];
    preTokenBalances: unknown[];
    postTokenBalances: unknown[];
  };
  history?: unknown;
}

/** Derives message fields from signed bytes and attaches deterministic RPC metadata. */
export const makeLockRpcFixture = (
  transaction: Transaction,
  profile: SolanaLockProfile,
  asset: string,
): LockRpcFixture => {
  const message = transaction.compileMessage();
  const payment = message.instructions[0];
  const policy = profile.assets[asset];
  const paymentData = Buffer.from(bs58.decode(payment.data));
  const amount = paymentData.readBigUInt64LE(asset === 'SOL' ? 4 : 1);
  const signature = transaction.signature;
  if (!signature || !transaction.verifySignatures())
    throw new Error('Fixture requires a signed message');
  const fixture: LockRpcFixture = {
    clusterGenesisHash: profile.clusterGenesisHash,
    destinationNetwork: profile.destinationNetwork,
    commitment: 'finalized',
    slot: 100,
    blockhash: keypair(233).publicKey.toBase58(),
    version: 'legacy',
    transaction: {
      signatures: [bs58.encode(signature)],
      message: {
        header: { ...message.header },
        accountKeys: message.accountKeys.map((key) => key.toBase58()),
        recentBlockhash: message.recentBlockhash,
        instructions: message.instructions.map((instruction) => ({
          ...instruction,
          accounts: [...instruction.accounts],
        })),
      },
    },
    meta: {
      err: null,
      fee: '5000',
      innerInstructions: [],
      loadedAddresses: { writable: [], readonly: [] },
      preBalances: message.accountKeys.map(() => '2000000'),
      postBalances: message.accountKeys.map(() => '2000000'),
      preTokenBalances: [],
      postTokenBalances: [],
    },
  };
  fixture.meta.postBalances[0] = '1995000';
  if (asset === 'SOL') {
    const [sourceIndex, destinationIndex] = payment.accounts;
    fixture.meta.preBalances[sourceIndex] = (amount + 2005000n).toString();
    fixture.meta.postBalances[sourceIndex] = '2000000';
    fixture.meta.postBalances[destinationIndex] = (amount + 2000000n).toString();
  } else {
    const [sourceIndex, , vaultIndex, authorityIndex] = payment.accounts;
    const source = message.accountKeys[sourceIndex].toBase58();
    const vault = message.accountKeys[vaultIndex].toBase58();
    const authority = message.accountKeys[authorityIndex].toBase58();
    /** Models an original SPL account with no delegate, extensions or close authority. */
    const state = (address: string, owner: string, rawAmount: bigint) => ({
      address,
      owner,
      mint: asset,
      amount: rawAmount.toString(),
      programOwner: SOLANA_SPL_PROGRAM_ID,
      state: 'initialized',
      extensions: [],
      delegate: null,
      closeAuthority: null,
    });
    const sourceBefore = state(source, authority, amount + 2000000n);
    const sourceAfter = state(source, authority, 2000000n);
    const vaultBefore = state(vault, profile.vaultOwner, 1000000n);
    const vaultAfter = state(vault, profile.vaultOwner, 1000000n + amount);
    /** Models the exact token-balance metadata for a recorded historical account. */
    const balance = (accountIndex: number, tokenState: ReturnType<typeof state>) => ({
      accountIndex,
      mint: asset,
      owner: tokenState.owner,
      programId: SOLANA_SPL_PROGRAM_ID,
      uiTokenAmount: { amount: tokenState.amount, decimals: policy.sourceDecimals, uiAmount: null },
    });
    fixture.meta.preTokenBalances = [
      balance(sourceIndex, sourceBefore),
      balance(vaultIndex, vaultBefore),
    ];
    fixture.meta.postTokenBalances = [
      balance(sourceIndex, sourceAfter),
      balance(vaultIndex, vaultAfter),
    ];
    const mintState = {
      programOwner: SOLANA_SPL_PROGRAM_ID,
      decimals: policy.sourceDecimals,
      extensions: [],
    };
    fixture.history = {
      slot: fixture.slot,
      sourceTxId: fixture.transaction.signatures[0],
      clusterGenesisHash: profile.clusterGenesisHash,
      mint: { address: asset, pre: { ...mintState }, post: { ...mintState } },
      source: { pre: sourceBefore, post: sourceAfter },
      vault: { pre: vaultBefore, post: vaultAfter },
    };
  }
  return fixture;
};

/** Loads the explicitly selected full built extractor and its own TokenMap dependency. */
export const makeRealExtractor = async (profile: SolanaLockProfile) => {
  const packageRoot = process.env.ROSEN_EXTRACTOR_PACKAGE;
  if (!packageRoot)
    throw new Error('Set ROSEN_EXTRACTOR_PACKAGE to the built companion rosen-extractor package');
  const extractorUrl = pathToFileURL(resolve(packageRoot, 'dist/index.js'));
  const { SolanaRosenExtractor } = await import(extractorUrl.href);
  if (typeof SolanaRosenExtractor !== 'function')
    throw new Error('Companion extractor has no Solana support');
  const require = createRequire(extractorUrl);
  const { TokenMap } = await import(pathToFileURL(require.resolve('@rosen-bridge/tokens')).href);
  const tokens = new TokenMap();
  await tokens.updateConfigByJson(
    Object.entries(profile.assets).map(([asset, policy]) => ({
      ergo: {
        tokenId: policy.destinationTokenId,
        name: 'wrapped fixture',
        decimals: policy.destinationDecimals,
        type: 'EIP-004',
        residency: 'wrapped',
        extra: {},
      },
      solana: {
        tokenId: asset === 'SOL' ? 'sol' : asset,
        name: 'source fixture',
        decimals: policy.sourceDecimals,
        type: 'native',
        residency: 'native',
        extra: {},
      },
    })),
  );
  return new SolanaRosenExtractor(
    {
      clusterGenesisHash: profile.clusterGenesisHash,
      destinationNetwork: profile.destinationNetwork,
      vaultOwner: profile.vaultOwner,
      assets: Object.fromEntries(
        Object.entries(profile.assets).map(([asset, policy]) => [
          asset,
          {
            minAmount: policy.minimumGrossAmount,
            maxAmount: policy.maximumGrossAmount,
            networkFee: policy.networkFee,
            bridgeFee: policy.bridgeFee,
            ...(policy.vaultTokenAccount ? { vaultTokenAccount: policy.vaultTokenAccount } : {}),
          },
        ]),
      ),
    },
    tokens,
  );
};

/** Initializes the actual shared address manager with companion codec validators. */
export const initializeCompanionAddressManager = async (): Promise<void> => {
  const packageRoot = process.env.ROSEN_EXTRACTOR_PACKAGE;
  if (!packageRoot)
    throw new Error('Set ROSEN_EXTRACTOR_PACKAGE to the built companion rosen-extractor package');
  const require = createRequire(pathToFileURL(resolve(packageRoot, 'dist/index.js')));
  const { AddressManager } = await import(
    pathToFileURL(require.resolve('@rosen-bridge/address-manager')).href
  );
  const { chainValidators, chainDecoders } = await import(
    pathToFileURL(require.resolve('@rosen-bridge/address-codec')).href
  );
  AddressManager.init(chainValidators, chainDecoders);
};

/** Mutates only one canonical Memo field, preserving all other JSON fields and order. */
export const replaceLockMemo = (
  fixture: LockRpcFixture,
  changes: Record<string, unknown>,
): void => {
  const instruction = fixture.transaction.message.instructions[1];
  const memo = JSON.parse(Buffer.from(bs58.decode(instruction.data)).toString('utf8'));
  instruction.data = bs58.encode(Buffer.from(JSON.stringify({ ...memo, ...changes })));
};
