import { Buffer } from 'buffer';

import bs58 from 'bs58';
import { describe, expect, it, vi } from 'vitest';

import {
  createSolanaRpcSubmitProducer,
  type SolanaRpcRequest,
  type SolanaRpcSubmissionRequest,
  type SolanaRpcTransport,
  serializeSolanaRpcRequest,
} from '@rosen-network/solana';

import { submissionRequest } from './rpcSubmitTestUtils';

describe('createSolanaRpcSubmitProducer', () => {
  /**
   * @target createSolanaRpcSubmitProducer rejects a missing transport at construction
   * @dependencies an invalid boundary value
   * @scenario construct the producer without a transport function
   * @expected configuration is rejected before a request exists
   */
  it('rejects a missing transport at construction', () => {
    expect(() => createSolanaRpcSubmitProducer(undefined as unknown as SolanaRpcTransport)).toThrow(
      'transport',
    );
  });

  /**
   * @target createSolanaRpcSubmitProducer rejects $name request shape
   * @dependencies valid signed fields and one isolated request-shape fault
   * @scenario pass the named shape through the public producer boundary
   * @expected reject without transport invocation
   */
  it.each([
    { name: 'null', change: (_request: SolanaRpcSubmissionRequest): unknown => null },
    { name: 'an array', change: (_request: SolanaRpcSubmissionRequest): unknown => [] },
    {
      name: 'a custom prototype',
      change: (request: SolanaRpcSubmissionRequest): unknown =>
        Object.assign(Object.create({ foreign: true }), request),
    },
    {
      name: 'an extra field',
      change: (request: SolanaRpcSubmissionRequest): unknown => ({ ...request, extra: true }),
    },
    {
      name: 'a missing signature',
      change: (request: SolanaRpcSubmissionRequest): unknown => ({
        wireBase64: request.wireBase64,
        contextSlot: request.contextSlot,
      }),
    },
  ])('rejects $name request shape', async ({ change }) => {
    const transport = vi.fn(async () => '');
    await expect(
      createSolanaRpcSubmitProducer(transport)(
        change(submissionRequest('SOL')) as SolanaRpcSubmissionRequest,
      ),
    ).rejects.toThrow('request');
    expect(transport).toHaveBeenCalledTimes(0);
  });

  /**
   * @target createSolanaRpcSubmitProducer submits exact %s wire before an external await
   * @dependencies deterministic signed wire and a captured raw transport
   * @scenario invoke the producer and inspect the transport before awaiting its acknowledgement
   * @expected one request retains bytes, preflight and exact above-safe context slot
   */
  it.each(['SOL', 'SPL'] as const)(
    'submits exact %s wire before an external await',
    async (asset) => {
      const request = submissionRequest(asset);
      const transport = vi.fn(async (rpc: SolanaRpcRequest) =>
        JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: request.expectedSignature }),
      );
      const pending = createSolanaRpcSubmitProducer(transport)(request);
      expect(transport).toHaveBeenCalledTimes(1);
      const rpc = transport.mock.calls[0][0];
      expect(rpc.method).toEqual('sendTransaction');
      expect(rpc.params[0]).toEqual(request.wireBase64);
      expect(rpc.params[1]).toEqual({
        encoding: 'base64',
        skipPreflight: false,
        preflightCommitment: 'finalized',
        maxRetries: 0,
        minContextSlot: request.contextSlot,
      });
      expect(serializeSolanaRpcRequest(rpc, 4096)).toContain('"minContextSlot":9007199254740993');
      expect(await pending).toEqual(request.expectedSignature);
    },
  );

  /**
   * @target createSolanaRpcSubmitProducer rejects $name before transport
   * @dependencies valid signed wire and a single changed request field
   * @scenario replace one field with the named invalid value and attempt submission
   * @expected rejection makes zero transport calls
   */
  it.each([
    { name: 'a different signature', changed: { expectedSignature: 'wrong' } },
    { name: 'malformed base64', changed: { wireBase64: '!invalid' } },
    { name: 'noncanonical base64', changed: { wireBase64: 'AAAA=' } },
    { name: 'oversized wire', changed: { wireBase64: 'A'.repeat(1648) } },
    { name: 'negative context', changed: { contextSlot: -1n } },
    { name: 'overflowed context', changed: { contextSlot: 18_446_744_073_709_551_616n } },
  ])('rejects $name before transport', async ({ changed }) => {
    const transport = vi.fn(async () => '');
    await expect(
      createSolanaRpcSubmitProducer(transport)({ ...submissionRequest('SOL'), ...changed }),
    ).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(0);
  });

  /**
   * @target createSolanaRpcSubmitProducer rejects an invalid signature even when its identifier matches
   * @dependencies canonical signed fixture and a single signature-byte mutation
   * @scenario mutate only the signature, derive its new identifier, and retain all message bytes
   * @expected serialization verification rejects before transport
   */
  it('rejects an invalid signature even when its identifier matches', async () => {
    const request = submissionRequest('SOL');
    const wire = Buffer.from(request.wireBase64, 'base64');
    wire[1] ^= 1;
    const transport = vi.fn(async () => '');
    await expect(
      createSolanaRpcSubmitProducer(transport)({
        ...request,
        wireBase64: wire.toString('base64'),
        expectedSignature: bs58.encode(wire.subarray(1, 65)),
      }),
    ).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(0);
  });

  /**
   * @target createSolanaRpcSubmitProducer propagates $name without a retry
   * @dependencies valid signed wire and a raw failed response
   * @scenario return a wrong response identifier or an RPC error envelope
   * @expected one handoff and a rejection
   */
  it.each(['correlation mismatch', 'RPC error'] as const)(
    'propagates %s without a retry',
    async (kind) => {
      const request = submissionRequest('SOL');
      const transport = vi.fn(async (rpc: SolanaRpcRequest) =>
        JSON.stringify(
          kind === 'RPC error'
            ? { jsonrpc: '2.0', id: rpc.id, error: { code: -32000, message: 'synthetic error' } }
            : { jsonrpc: '2.0', id: rpc.id + 1, result: request.expectedSignature },
        ),
      );
      await expect(createSolanaRpcSubmitProducer(transport)(request)).rejects.toThrow(
        kind === 'RPC error' ? 'ERROR_RESPONSE' : 'ID_MISMATCH',
      );
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );

  /**
   * @target createSolanaRpcSubmitProducer refuses request accessors without invoking them
   * @dependencies signed wire with a hostile signature property
   * @scenario replace the signature field with a getter
   * @expected no getter or transport invocation
   */
  it('refuses request accessors without invoking them', async () => {
    let accesses = 0;
    const request = { ...submissionRequest('SOL') };
    Object.defineProperty(request, 'expectedSignature', {
      get: () => {
        accesses++;
        return 'wrong';
      },
    });
    const transport = vi.fn(async () => '');
    await expect(createSolanaRpcSubmitProducer(transport)(request)).rejects.toThrow('fields');
    expect(accesses).toEqual(0);
    expect(transport).toHaveBeenCalledTimes(0);
  });

  /**
   * @target createSolanaRpcSubmitProducer rejects $name acknowledgement
   * @dependencies valid signed wire and one invalid raw response
   * @scenario send exactly once and return the isolated malformed acknowledgement
   * @expected reject without a retry
   */
  it.each([
    { name: 'another signature', result: 'different' },
    { name: 'a non-string signature', result: null },
  ])('rejects $name acknowledgement', async ({ result }) => {
    const transport = vi.fn(async (rpc: SolanaRpcRequest) =>
      JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }),
    );
    await expect(
      createSolanaRpcSubmitProducer(transport)(submissionRequest('SOL')),
    ).rejects.toThrow('different');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  /**
   * @target createSolanaRpcSubmitProducer preserves captured wire and signature during response wait
   * @dependencies mutable caller request and a deferred transport
   * @scenario alter caller fields after the transport has received its immutable request
   * @expected acknowledge the original signature and retain the original submitted bytes
   */
  it('preserves captured wire and signature during response wait', async () => {
    const original = submissionRequest('SOL');
    const request: SolanaRpcSubmissionRequest = { ...original };
    let resolve!: (value: string) => void;
    const transport = vi.fn(
      (_rpc: SolanaRpcRequest) =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    const pending = createSolanaRpcSubmitProducer(transport)(request);
    Object.assign(request, {
      wireBase64: 'changed',
      expectedSignature: 'changed',
      contextSlot: 0n,
    });
    resolve(JSON.stringify({ jsonrpc: '2.0', id: 1, result: original.expectedSignature }));
    expect(await pending).toEqual(original.expectedSignature);
    expect(transport.mock.calls[0][0].params[0]).toEqual(original.wireBase64);
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
