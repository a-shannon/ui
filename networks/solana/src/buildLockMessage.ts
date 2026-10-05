import { Buffer } from 'buffer';

import { createTransferCheckedInstruction, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';

import {
  ERGO_SIGNED_AMOUNT_MAX,
  isCapturedSolanaLockProfile,
  SOLANA_MEMO_PROGRAM_ID,
  SOLANA_SPL_PROGRAM_ID,
  SOLANA_SYSTEM_PROGRAM_ID,
  SOLANA_U64_MAX,
  type SolanaLockProfile,
  validateSolanaLockTarget,
} from './lockProfile';

export interface SolanaLockRequest {
  readonly asset: string;
  readonly grossAmount: string;
  readonly destinationAddress: string;
  readonly senderAddress: string;
  readonly recentBlockhash: string;
  readonly sourceTokenAccount?: string;
}

export interface SolanaLockBuild {
  readonly transaction: Transaction;
  readonly sourceAuthority: string;
  readonly asset: string;
  readonly grossAmount: string;
  readonly memo: string;
}

interface BuildEvidence {
  readonly messageBytes: Uint8Array;
  readonly sourceAuthority: string;
  readonly asset: string;
  readonly grossAmount: string;
  readonly memo: string;
}

const buildEvidence = new WeakMap<SolanaLockBuild, BuildEvidence>();

/** Requires a canonical key or blockhash before instruction construction. */
const parsePublicKey = (value: unknown, label: string): PublicKey => {
  if (typeof value !== 'string') throw new TypeError(`Invalid ${label}`);
  try {
    const key = new PublicKey(value);
    if (key.toBase58() !== value) throw new Error('noncanonical');
    return key;
  } catch {
    throw new TypeError(`Invalid ${label}`);
  }
};

/** Parses a bounded canonical u64 amount without floating-point conversion. */
const parseUint = (value: unknown, label: string): bigint => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value))
    throw new TypeError(`Invalid ${label}`);
  const parsed = BigInt(value);
  if (parsed > SOLANA_U64_MAX) throw new RangeError(`${label} exceeds u64`);
  return parsed;
};

/** Converts only amounts that have an exact destination-unit representation. */
const exactErgoUnits = (
  amount: bigint,
  sourceDecimals: number,
  destinationDecimals: number,
): bigint => {
  const delta = destinationDecimals - sourceDecimals;
  if (delta >= 0) return amount * 10n ** BigInt(delta);
  const divisor = 10n ** BigInt(-delta);
  if (amount % divisor !== 0n) throw new RangeError('Gross amount would lose Ergo units');
  return amount / divisor;
};

/** Compares every byte of the complete compiled legacy message. */
const equalBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length && left.every((byte, index) => byte === right[index]);

/**
 * Builds a legacy payment followed by the extractor's canonical Memo-v1
 * instruction. It returns an unsigned transaction and never contacts a node.
 */
export const buildSolanaLockMessage = (
  profile: SolanaLockProfile,
  request: SolanaLockRequest,
): SolanaLockBuild => {
  if (!isCapturedSolanaLockProfile(profile))
    throw new TypeError('Solana lock profile was not captured');
  const capturedRequest = Object.freeze({ ...request });
  const expectedKeys = capturedRequest.sourceTokenAccount
    ? [
        'asset',
        'grossAmount',
        'destinationAddress',
        'senderAddress',
        'recentBlockhash',
        'sourceTokenAccount',
      ]
    : ['asset', 'grossAmount', 'destinationAddress', 'senderAddress', 'recentBlockhash'];
  const actualKeys = Object.keys(capturedRequest).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpectedKeys.length ||
    actualKeys.some((key, index) => key !== sortedExpectedKeys[index])
  )
    throw new TypeError('Unexpected Solana lock request fields');
  if (
    typeof capturedRequest.asset !== 'string' ||
    !Object.hasOwn(profile.assets, capturedRequest.asset)
  )
    throw new TypeError('Asset is not in the captured allowlist');
  const policy = profile.assets[capturedRequest.asset];
  if (!policy) throw new TypeError('Asset is not in the captured allowlist');
  const amount = parseUint(capturedRequest.grossAmount, 'gross amount');
  const minimum = BigInt(policy.minimumGrossAmount);
  const maximum = BigInt(policy.maximumGrossAmount);
  const networkFee = BigInt(policy.networkFee);
  const bridgeFee = BigInt(policy.bridgeFee);
  if (amount < minimum || amount > maximum)
    throw new RangeError('Gross amount is outside the captured asset limits');
  if (networkFee + bridgeFee >= amount) throw new RangeError('Fees exhaust the gross payment');
  const convertedAmount = exactErgoUnits(amount, policy.sourceDecimals, policy.destinationDecimals);
  exactErgoUnits(networkFee, policy.sourceDecimals, policy.destinationDecimals);
  exactErgoUnits(bridgeFee, policy.sourceDecimals, policy.destinationDecimals);
  if (convertedAmount > ERGO_SIGNED_AMOUNT_MAX)
    throw new RangeError('Gross amount exceeds Ergo signed range');

  const sender = parsePublicKey(capturedRequest.senderAddress, 'sender address');
  const vaultOwner = parsePublicKey(profile.vaultOwner, 'vault owner');
  const recentBlockhash = parsePublicKey(capturedRequest.recentBlockhash, 'recent blockhash');
  if (sender.equals(vaultOwner)) throw new TypeError('Vault owner cannot be the sender');
  validateSolanaLockTarget(capturedRequest.destinationAddress, profile);
  if (
    capturedRequest.destinationAddress.length > 256 ||
    !/^[\x21-\x7e]+$/.test(capturedRequest.destinationAddress)
  )
    throw new TypeError('Invalid Ergo destination');

  const transaction = new Transaction({
    feePayer: sender,
    recentBlockhash: recentBlockhash.toBase58(),
  });
  let payment: TransactionInstruction;
  if (policy.kind === 'native') {
    if (capturedRequest.sourceTokenAccount !== undefined)
      throw new TypeError('Native SOL request cannot include a token account');
    payment = SystemProgram.transfer({
      fromPubkey: sender,
      toPubkey: vaultOwner,
      lamports: amount,
    });
  } else {
    if (!capturedRequest.sourceTokenAccount)
      throw new TypeError('SPL request must include its source token account');
    const sourceTokenAccount = parsePublicKey(
      capturedRequest.sourceTokenAccount,
      'source token account',
    );
    const mint = parsePublicKey(capturedRequest.asset, 'SPL mint');
    const vaultTokenAccount = parsePublicKey(policy.vaultTokenAccount, 'vault token account');
    if (
      sourceTokenAccount.equals(vaultTokenAccount) ||
      sourceTokenAccount.equals(mint) ||
      vaultTokenAccount.equals(mint)
    )
      throw new TypeError('Invalid SPL source, mint, or vault token account');
    if (TOKEN_PROGRAM_ID.toBase58() !== SOLANA_SPL_PROGRAM_ID)
      throw new Error('SPL Token program identity mismatch');
    payment = createTransferCheckedInstruction(
      sourceTokenAccount,
      mint,
      vaultTokenAccount,
      sender,
      amount,
      policy.sourceDecimals,
      [],
      TOKEN_PROGRAM_ID,
    );
  }

  const memo = JSON.stringify({
    v: 1,
    toChain: 'ergo',
    toAddress: capturedRequest.destinationAddress,
    asset: capturedRequest.asset,
    amount: amount.toString(),
    networkFee: policy.networkFee,
    bridgeFee: policy.bridgeFee,
  });
  const memoInstruction = new TransactionInstruction({
    programId: new PublicKey(SOLANA_MEMO_PROGRAM_ID),
    keys: [{ pubkey: sender, isSigner: true, isWritable: false }],
    data: Buffer.from(memo, 'utf8'),
  });
  transaction.add(payment, memoInstruction);

  const compiled = transaction.compileMessage();
  const messageBytes = transaction.serializeMessage();
  const expectedPaymentProgram =
    policy.kind === 'native' ? SOLANA_SYSTEM_PROGRAM_ID : SOLANA_SPL_PROGRAM_ID;
  if (
    compiled.instructions.length !== 2 ||
    !compiled.accountKeys[0].equals(sender) ||
    compiled.accountKeys[compiled.instructions[0].programIdIndex].toBase58() !==
      expectedPaymentProgram ||
    compiled.accountKeys[compiled.instructions[1].programIdIndex].toBase58() !==
      SOLANA_MEMO_PROGRAM_ID ||
    compiled.header.numRequiredSignatures !== 1 ||
    messageBytes.length + 65 > 1232
  )
    throw new RangeError('Compiled Solana lock message violates size or layout limits');

  const result: SolanaLockBuild = Object.freeze({
    transaction,
    sourceAuthority: sender.toBase58(),
    asset: capturedRequest.asset,
    grossAmount: amount.toString(),
    memo,
  });
  buildEvidence.set(result, {
    messageBytes: Uint8Array.from(messageBytes),
    sourceAuthority: sender.toBase58(),
    asset: capturedRequest.asset,
    grossAmount: amount.toString(),
    memo,
  });
  return result;
};

/** Compares a transaction to the exact message captured by its builder. */
export const hasCapturedSolanaLockMessage = (
  build: SolanaLockBuild,
  candidate: Transaction = build.transaction,
): boolean => {
  const evidence = buildEvidence.get(build);
  if (!evidence) return false;
  try {
    return equalBytes(candidate.serializeMessage(), evidence.messageBytes);
  } catch {
    return false;
  }
};

/** Returns a detached copy so callers cannot alter the captured message evidence. */
export const getSolanaLockBuildEvidence = (build: SolanaLockBuild): BuildEvidence | undefined => {
  const evidence = buildEvidence.get(build);
  return evidence
    ? Object.freeze({ ...evidence, messageBytes: Uint8Array.from(evidence.messageBytes) })
    : undefined;
};
