import { Buffer } from 'buffer';

import { Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { describe, expect, it, vi } from 'vitest';

import {
  createSolanaRpcSubmitProducer,
  type SolanaRpcRequest,
  serializeSolanaRpcRequest,
} from '@rosen-network/solana';

import { isCurrentSolanaSignedLock } from '../src/quotedSigner';
import { SolanaAmbiguousSubmissionError, submitSolanaSignedLock } from '../src/submission';
import { deferredReadPortResult } from './readPortTestUtils';
import { createSignedSubmissionFixture } from './submissionTestUtils';
import { keypair } from './testUtils';

describe('submitSolanaSignedLock', () => {
  /**
   * @target submitSolanaSignedLock hands off the exact verified %s transaction wire once
   * @dependencies actual event/session, quote, verified signer and transaction decoder; synthetic wallet/services/send callback
   * @scenario prepare, sign and refresh a native or original-SPL lock before acknowledging its exact wire signature
   * @expected frozen request contains canonical signed bytes and the decoded first transaction signature
   */
  it.each(['native', 'spl'] as const)(
    'hands off the exact verified %s transaction wire once',
    async (kind) => {
      const f = await createSignedSubmissionFixture(kind);
      try {
        let calls = 0;
        let expectedSignature = '';
        let handedWire = '';
        let contextSlot = 0n;
        const transport = vi.fn(async (rpc: SolanaRpcRequest) =>
          JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: expectedSignature }),
        );
        const send = createSolanaRpcSubmitProducer(transport);
        const signature = await submitSolanaSignedLock(f.lock, async (request) => {
          calls += 1;
          expect(isCurrentSolanaSignedLock(f.lock)).toEqual(false);
          handedWire = request.wireBase64;
          expectedSignature = request.expectedSignature;
          contextSlot = request.contextSlot;
          expect(Object.isFrozen(request)).toEqual(true);
          const decoded = Transaction.from(Buffer.from(request.wireBase64, 'base64'));
          expect(decoded.verifySignatures()).toEqual(true);
          expect(bs58.encode(decoded.signatures[0]!.signature!)).toEqual(request.expectedSignature);
          expect(f.producers.readBalance).toHaveBeenCalledTimes(4);
          return send(request);
        });

        expect(calls).toEqual(1);
        expect(transport).toHaveBeenCalledTimes(1);
        const rpc = transport.mock.calls[0][0];
        expect(rpc.method).toEqual('sendTransaction');
        expect(rpc.params[0]).toEqual(handedWire);
        expect(rpc.params[1]).toMatchObject({
          encoding: 'base64',
          skipPreflight: false,
          preflightCommitment: 'finalized',
          maxRetries: 0,
          minContextSlot: contextSlot,
        });
        expect(serializeSolanaRpcRequest(rpc, 4096)).toContain(`"minContextSlot":${contextSlot}`);
        expect(signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
        expect(f.wallet.provider.signTransaction).toHaveBeenCalledTimes(1);
        expect(isCurrentSolanaSignedLock(f.lock)).toEqual(false);
      } finally {
        f.port.dispose();
      }
    },
  );

  /**
   * @target submitSolanaSignedLock refuses copied or foreign wire handles before send
   * @dependencies actual signed lock plus detached caller-created records and inert callback
   * @scenario submit a shallow copy and a separate unbranded wire record that carry identical public fields
   * @expected neither detached record passes local provenance and no callback is invoked
   */
  it('refuses copied and foreign wire handles before send', async () => {
    const f = await createSignedSubmissionFixture();
    try {
      const send = vi.fn(async () => 'unused');
      const copied = { ...f.lock };
      const foreign = Object.freeze({ quote: f.lock.quote, wireBase64: f.lock.wireBase64 });
      await expect(submitSolanaSignedLock(copied, send)).rejects.toThrow(
        'Solana signed lock is stale or not captured',
      );
      await expect(submitSolanaSignedLock(foreign, send)).rejects.toThrow(
        'Solana signed lock is stale or not captured',
      );
      expect(isCurrentSolanaSignedLock(f.lock)).toEqual(true);
    } finally {
      f.port.dispose();
    }
  });

  /**
   * @target submitSolanaSignedLock refuses expired quote state before callback handoff
   * @dependencies actual event/session, signed quote and synthetic height producer
   * @scenario advance the confirmed block height beyond the captured last-valid height before submission
   * @expected freshness validation retires the signed handle and no send callback runs
   */
  it('refuses expired quote state before callback handoff', async () => {
    const f = await createSignedSubmissionFixture();
    try {
      f.height.blockHeight = 201n;
      let calls = 0;
      const send = vi.fn(async () => {
        calls += 1;
        return 'unused';
      });
      await expect(submitSolanaSignedLock(f.lock, send)).rejects.toThrow(
        'Solana quote blockhash expired',
      );
      expect(isCurrentSolanaSignedLock(f.lock)).toEqual(false);
      expect(calls).toEqual(0);
    } finally {
      f.port.dispose();
    }
  });

  /**
   * @target submitSolanaSignedLock refuses a session revoked during freshness reads
   * @dependencies actual event-bound wallet, signed quote, deferred synthetic balance read
   * @scenario pause the real quote revalidation, emit disconnect, then release the pending read
   * @expected revoked session prevents callback invocation and leaves no current signed handle
   */
  it('refuses a session revoked during freshness reads', async () => {
    const f = await createSignedSubmissionFixture();
    try {
      const originalRead = f.producers.readBalance.getMockImplementation();
      if (!originalRead) throw new Error('Missing fixture balance callback');
      const deferred = deferredReadPortResult();
      let started!: () => void;
      const readStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      f.producers.readBalance.mockImplementationOnce(async (request) => {
        started();
        await deferred.promise;
        return originalRead(request);
      });
      let calls = 0;
      const send = vi.fn(async () => {
        calls += 1;
        return 'unused';
      });
      const pending = submitSolanaSignedLock(f.lock, send);
      await readStarted;
      f.wallet.emit('disconnect');
      const rejected = expect(pending).rejects.toThrow('Solana wallet session is stale');
      deferred.resolve(undefined);
      await rejected;
      expect(calls).toEqual(0);
      expect(isCurrentSolanaSignedLock(f.lock)).toEqual(false);
    } finally {
      f.port.dispose();
    }
  });

  /**
   * @target submitSolanaSignedLock permits one handoff under concurrent calls for one signed handle
   * @dependencies actual signed handle, deferred synthetic quote revalidation and inert callback counter
   * @scenario hold the first freshness read and start a second submission using the same signed handle
   * @expected one call is rejected as stale and only the first operation reaches the callback
   */
  it('permits one handoff under concurrent calls for one signed handle', async () => {
    const f = await createSignedSubmissionFixture();
    try {
      const originalRead = f.producers.readBalance.getMockImplementation();
      if (!originalRead) throw new Error('Missing fixture balance callback');
      const deferred = deferredReadPortResult();
      let started!: () => void;
      const readStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      f.producers.readBalance.mockImplementationOnce(async (request) => {
        started();
        await deferred.promise;
        return originalRead(request);
      });
      let calls = 0;
      const send = async (request: { readonly expectedSignature: string }) => {
        calls += 1;
        return request.expectedSignature;
      };
      const first = submitSolanaSignedLock(f.lock, send);
      await readStarted;
      await expect(submitSolanaSignedLock(f.lock, send)).rejects.toThrow(
        'Solana signed lock is stale or not captured',
      );
      const firstResult = expect(first).resolves.toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
      deferred.resolve(undefined);
      await firstResult;
      expect(calls).toEqual(1);
    } finally {
      f.port.dispose();
    }
  });

  /**
   * @target submitSolanaSignedLock reports transport failure as ambiguous with the expected signature
   * @dependencies actual signed wire and a deterministic callback that throws after invocation
   * @scenario let the transport callback begin and then reject with an unknown-delivery error
   * @expected typed error retains the decoded transaction signature and original callback failure
   */
  it('reports transport failure as ambiguous with the expected signature', async () => {
    const f = await createSignedSubmissionFixture();
    try {
      const cause = new Error('synthetic transport timeout');
      let expectedSignature = '';
      const send = async (request: { readonly expectedSignature: string }): Promise<string> => {
        expectedSignature = request.expectedSignature;
        throw cause;
      };
      const rejected = await submitSolanaSignedLock(f.lock, send).catch((error: unknown) => error);
      if (!(rejected instanceof SolanaAmbiguousSubmissionError))
        throw new Error('Submission did not produce an ambiguous transport error');
      expect(rejected.expectedSignature).toEqual(expectedSignature);
      expect(rejected.causeValue).toBe(cause);
    } finally {
      f.port.dispose();
    }
  });

  /**
   * @target submitSolanaSignedLock treats a missing or mismatched callback signature as ambiguous
   * @dependencies actual signed wire and synthetic callback acknowledgments
   * @scenario return a wrong nonempty signature after the single callback handoff
   * @expected callback mismatch cannot be reported as a successful transaction identifier
   */
  it.each([
    { label: 'mismatched', value: bs58.encode(keypair(99).secretKey.slice(0, 64)) },
    { label: 'missing', value: undefined },
  ])('treats a $label callback signature as ambiguous', async ({ value }) => {
    const f = await createSignedSubmissionFixture();
    try {
      let expectedSignature = '';
      const rejected = await submitSolanaSignedLock(f.lock, async (request) => {
        expectedSignature = request.expectedSignature;
        return value as string;
      }).catch((error: unknown) => error);
      if (!(rejected instanceof SolanaAmbiguousSubmissionError))
        throw new Error('Submission did not produce an ambiguous acknowledgment error');
      expect(rejected.expectedSignature).toEqual(expectedSignature);
      expect(rejected.causeValue).toBeInstanceOf(Error);
    } finally {
      f.port.dispose();
    }
  });

  /**
   * @target submitSolanaSignedLock freezes request parameters and isolates the exact wire from mutation
   * @dependencies actual signed wire plus a callback that attempts parameter and decoded-byte changes
   * @scenario try to replace frozen request fields and mutate a detached decoded transaction buffer
   * @expected callback can acknowledge only the unchanged captured wire and signature identity
   */
  it('freezes request parameters and isolates exact wire from mutation', async () => {
    const f = await createSignedSubmissionFixture();
    try {
      const signedWire = f.lock.wireBase64;
      let expectedSignature = '';
      const result = await submitSolanaSignedLock(f.lock, async (request) => {
        expectedSignature = request.expectedSignature;
        expect(Reflect.set(request, 'wireBase64', 'changed')).toEqual(false);
        expect(Reflect.set(request, 'expectedSignature', 'changed')).toEqual(false);
        const detached = Uint8Array.from(Buffer.from(request.wireBase64, 'base64'));
        detached[0] ^= 0xff;
        expect(Buffer.from(detached).toString('base64')).not.toEqual(request.wireBase64);
        expect(request.wireBase64).toEqual(signedWire);
        return request.expectedSignature;
      });
      expect(result).toEqual(expectedSignature);
      expect(f.lock.wireBase64).toEqual(signedWire);
    } finally {
      f.port.dispose();
    }
  });

  /**
   * @target submitSolanaSignedLock preserves a valid acknowledgment after wallet account change
   * @dependencies actual event-bound wallet and a deferred configured send callback
   * @scenario begin callback handoff, emit an account change, then acknowledge the original wire signature
   * @expected successful callback acknowledgment is returned despite later session revocation
   */
  it('preserves acknowledgment after wallet account change', async () => {
    const f = await createSignedSubmissionFixture();
    try {
      let markStarted!: (signature: string) => void;
      const started = new Promise<string>((resolve) => {
        markStarted = resolve;
      });
      let acknowledge!: (signature: string) => void;
      const response = new Promise<string>((resolve) => {
        acknowledge = resolve;
      });
      const pending = submitSolanaSignedLock(f.lock, async (request) => {
        markStarted(request.expectedSignature);
        return response;
      });
      const expectedSignature = await started;
      f.wallet.provider.publicKey = keypair(2).publicKey;
      f.wallet.emit('accountChanged');
      acknowledge(expectedSignature);
      await expect(pending).resolves.toEqual(expectedSignature);
      expect(isCurrentSolanaSignedLock(f.lock)).toEqual(false);
    } finally {
      f.port.dispose();
    }
  });
});
