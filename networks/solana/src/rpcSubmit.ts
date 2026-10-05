import { Buffer } from 'buffer';

import { Transaction } from '@solana/web3.js';
import bs58 from 'bs58';

import { createRpcCaller, type SolanaRpcTransport, stringValue } from './rpcProtocol';

/** Exact signed bytes and their locally verified identifier, supplied by the wallet. */
export interface SolanaRpcSubmissionRequest {
  readonly wireBase64: string;
  readonly expectedSignature: string;
  readonly contextSlot: bigint;
}

/**
 * Sends through the configured transport without a pre-send external await.
 * The wallet owns freshness and one-use handoff. The returned signature only
 * acknowledges RPC acceptance; it does not establish execution or finality.
 */
export const createSolanaRpcSubmitProducer = (transport: SolanaRpcTransport) => {
  if (typeof transport !== 'function') throw new TypeError('Invalid Solana submission transport');
  const call = createRpcCaller(transport);
  return async (request: SolanaRpcSubmissionRequest): Promise<string> => {
    if (typeof request !== 'object' || request === null || Array.isArray(request))
      throw new TypeError('Invalid Solana submission request');
    const prototype = Object.getPrototypeOf(request);
    if (prototype !== Object.prototype && prototype !== null)
      throw new TypeError('Invalid Solana submission request prototype');
    const fields = Object.getOwnPropertyDescriptors(request);
    const names = ['wireBase64', 'expectedSignature', 'contextSlot'];
    if (
      Reflect.ownKeys(fields).length !== names.length ||
      names.some((name) => !fields[name] || !Object.hasOwn(fields[name], 'value'))
    )
      throw new TypeError('Invalid Solana submission request fields');
    const wireBase64: unknown = fields.wireBase64.value;
    const expectedSignature: unknown = fields.expectedSignature.value;
    const contextSlot: unknown = fields.contextSlot.value;
    if (
      typeof wireBase64 !== 'string' ||
      wireBase64.length > 1644 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(wireBase64)
    )
      throw new TypeError('Invalid Solana submission wire');
    const wire = Buffer.from(wireBase64, 'base64');
    if (wire.length > 1232 || wire.toString('base64') !== wireBase64)
      throw new TypeError('Invalid Solana submission wire encoding');
    const transaction = Transaction.from(wire);
    const signature = transaction.signature;
    if (
      !signature ||
      transaction.signatures.length !== 1 ||
      transaction.serialize().toString('base64') !== wireBase64 ||
      typeof expectedSignature !== 'string' ||
      bs58.encode(signature) !== expectedSignature
    )
      throw new TypeError('Solana submission signature differs from verified wire');
    if (
      typeof contextSlot !== 'bigint' ||
      contextSlot < 0n ||
      contextSlot > 18_446_744_073_709_551_615n
    )
      throw new TypeError('Invalid Solana submission context slot');
    const result = await call('sendTransaction', [
      wireBase64,
      Object.freeze({
        encoding: 'base64',
        skipPreflight: false,
        preflightCommitment: 'finalized',
        maxRetries: 0,
        minContextSlot: contextSlot,
      }),
    ]);
    if (stringValue(result.result) !== expectedSignature)
      throw new Error('Solana RPC returned a different transaction signature');
    return expectedSignature;
  };
};
