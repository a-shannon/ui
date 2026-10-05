import { describe, expect, it, vi } from 'vitest';

import { createRpcCaller, createSolanaRpcTransport } from '@rosen-network/solana';

import {
  acceptedContentTypes,
  rejectedContentTypes,
  successfulResponseTexts,
} from './rpcTransportTestData';
import {
  responseFromChunks,
  transportOptions,
  transportRequest,
  unresolvedResponse,
  utf8Chunk,
} from './rpcTransportTestUtils';

describe('createSolanaRpcTransport', () => {
  /**
   * @target createSolanaRpcTransport sends one explicit POST with exact BigInt parameter lexemes
   * @dependencies injected local fetch, createRpcCaller, and one valid raw response envelope
   * @scenario call getBalance with an above-safe minContextSlot and a marker-like string
   * @expected one request uses explicit browser-safe options and preserves the u64 integer token
   */
  it('createSolanaRpcTransport sends one explicit POST with exact BigInt parameter lexemes', async () => {
    let capturedURL: RequestInfo | URL | undefined;
    let capturedInit: RequestInit | undefined;
    let callCount = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      callCount += 1;
      capturedURL = input;
      capturedInit = init;
      return new Response(successfulResponseTexts[0], {
        headers: { 'content-type': 'application/json' },
      });
    };
    const transport = createSolanaRpcTransport(
      transportOptions(fetchImpl, {
        maxRequestBytes: 256,
        maxResponseBytes: 256,
      }),
    );
    const call = createRpcCaller(transport);
    const parsed = await call('getBalance', [
      'wallet',
      { commitment: 'finalized', minContextSlot: 9007199254740993n },
      '__BIGINT_9007199254740993__',
    ]);

    expect(callCount).toEqual(1);
    expect(capturedURL?.toString()).toEqual('https://rpc.example.invalid/solana?fixture=local');
    expect(capturedInit?.method).toEqual('POST');
    expect(capturedInit?.headers).toEqual({
      'content-type': 'application/json',
      accept: 'application/json',
    });
    expect(capturedInit?.credentials).toEqual('omit');
    expect(capturedInit?.redirect).toEqual('error');
    expect(capturedInit?.body).toEqual(
      '{"jsonrpc":"2.0","id":1,"method":"getBalance","params":["wallet",{"commitment":"finalized","minContextSlot":9007199254740993},"__BIGINT_9007199254740993__"]}',
    );
    expect(parsed.result.kind).toEqual('atom');
    expect(parsed.raw).toEqual(successfulResponseTexts[0]);
  });

  /**
   * @target createSolanaRpcTransport accepts $name
   * @dependencies injected local fetch and one response fixture per accepted media-type case
   * @scenario read the body with application JSON, vendor JSON or no media-type header
   * @expected original response text is returned without envelope parsing or normalization
   */
  it.each(acceptedContentTypes)(
    'createSolanaRpcTransport accepts $name',
    async ({ contentType }) => {
      const raw = successfulResponseTexts[0];
      const fetchImpl: typeof fetch = async () =>
        responseFromChunks([utf8Chunk(raw)], { contentType });
      const transport = createSolanaRpcTransport(
        transportOptions(fetchImpl, {
          maxRequestBytes: 256,
          maxResponseBytes: 256,
        }),
      );

      expect(await transport(transportRequest())).toEqual(raw);
    },
  );

  /**
   * @target createSolanaRpcTransport rejects $name
   * @dependencies injected local fetch and one isolated non-JSON Content-Type value
   * @scenario return a success status with the unsupported response media type
   * @expected the transport refuses to parse or return the body with a stable media-type code
   */
  it.each(rejectedContentTypes)(
    'createSolanaRpcTransport rejects $name',
    async ({ contentType }) => {
      const fetchImpl: typeof fetch = async () =>
        responseFromChunks([utf8Chunk(successfulResponseTexts[0])], {
          contentType,
        });
      const transport = createSolanaRpcTransport(transportOptions(fetchImpl));

      await expect(transport(transportRequest())).rejects.toThrow(
        'SOLANA_RPC_CONTENT_TYPE_INVALID',
      );
    },
  );

  /**
   * @target createSolanaRpcTransport cancels bodies for rejected media types
   * @dependencies an injected response with a pending body stream and a non-JSON media type
   * @scenario reject response headers before starting a body reader
   * @expected the pending stream is canceled promptly instead of remaining unconsumed
   */
  it('createSolanaRpcTransport cancels bodies for rejected media types', async () => {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise(() => undefined);
      },
      cancel() {
        canceled = true;
      },
    });
    const fetchImpl: typeof fetch = async () =>
      new Response(body, { headers: { 'content-type': 'text/plain' } });
    const transport = createSolanaRpcTransport(transportOptions(fetchImpl));
    await expect(transport(transportRequest())).rejects.toThrow('SOLANA_RPC_CONTENT_TYPE_INVALID');
    await Promise.resolve();
    expect(canceled).toEqual(true);
  });

  /**
   * @target createSolanaRpcTransport validates configuration without defaults
   * @dependencies isolated malformed endpoint and option values with an injected fetch that must not run
   * @scenario create transports with missing, unsafe or out-of-range configuration values
   * @expected invalid endpoints and numeric limits fail at construction without contacting fetch
   */
  it('createSolanaRpcTransport validates configuration without defaults', () => {
    const fetchImpl: typeof fetch = async () => new Response();
    const base = transportOptions(fetchImpl);
    const invalidEndpoints = [
      'file:///tmp/rpc',
      'https://user:secret@rpc.example.invalid/path',
      'https://rpc.example.invalid/path#',
    ];
    for (const endpointURL of invalidEndpoints)
      expect(() => createSolanaRpcTransport({ ...base, endpointURL })).toThrow(
        'SOLANA_RPC_ENDPOINT_INVALID',
      );
    expect(() => createSolanaRpcTransport({ ...base, timeoutMs: 0 })).toThrow(
      'SOLANA_RPC_TRANSPORT_CONFIG_INVALID',
    );
    expect(() => createSolanaRpcTransport({ ...base, timeoutMs: 2_147_483_648 })).toThrow(
      'SOLANA_RPC_TRANSPORT_CONFIG_INVALID',
    );
    expect(() => createSolanaRpcTransport({ ...base, maxResponseBytes: 1_048_577 })).toThrow(
      'SOLANA_RPC_TRANSPORT_CONFIG_INVALID',
    );
    expect(() => createSolanaRpcTransport({ ...base, maxRequestBytes: 0 })).toThrow(
      'SOLANA_RPC_TRANSPORT_CONFIG_INVALID',
    );
    expect(() => createSolanaRpcTransport({ ...base, extra: true } as never)).toThrow(
      'SOLANA_RPC_TRANSPORT_CONFIG_INVALID',
    );
  });

  /**
   * @target createSolanaRpcTransport does not retain fetch endpoint mutations
   * @dependencies one injected fetch implementation that mutates URL objects it receives
   * @scenario reuse the same transport after an adversarial fetch mutates its first endpoint argument
   * @expected both requests retain the original captured endpoint
   */
  it('createSolanaRpcTransport does not retain fetch endpoint mutations', async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      seen.push(String(input));
      if (input instanceof URL) input.hostname = 'mutated.invalid';
      return new Response(successfulResponseTexts[0], {
        headers: { 'content-type': 'application/json' },
      });
    };
    const transport = createSolanaRpcTransport(transportOptions(fetchImpl));
    await transport(transportRequest());
    await transport(transportRequest());
    expect(seen).toEqual([
      'https://rpc.example.invalid/solana?fixture=local',
      'https://rpc.example.invalid/solana?fixture=local',
    ]);
  });

  /**
   * @target createSolanaRpcTransport rejects non-2xx status without exposing response data
   * @dependencies one local 503 response containing a private-looking body marker
   * @scenario attempt a single request to a URL that contains a harmless fixture query marker
   * @expected one generic HTTP failure is returned and neither the URL nor response body is echoed
   */
  it('createSolanaRpcTransport rejects non-2xx status without exposing response data', async () => {
    let callCount = 0;
    const fetchImpl: typeof fetch = async () => {
      callCount += 1;
      return new Response('fixture-secret-body', { status: 503 });
    };
    const transport = createSolanaRpcTransport(transportOptions(fetchImpl));

    let caught: unknown;
    try {
      await transport(transportRequest());
    } catch (error) {
      caught = error;
    }
    expect(callCount).toEqual(1);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toEqual('SOLANA_RPC_HTTP_ERROR');
    expect((caught as Error).message.includes('fixture-secret-body')).toEqual(false);
    expect((caught as Error).message.includes('fixture=local')).toEqual(false);
  });

  /**
   * @target createSolanaRpcTransport enforces the streaming response-byte cap
   * @dependencies local response streams with split ASCII chunks at and over the byte limit
   * @scenario collect exactly six bytes and then attempt a seven-byte response
   * @expected the exact cap returns intact text and one additional byte fails before joining
   */
  it('createSolanaRpcTransport enforces the streaming response-byte cap', async () => {
    const exact: typeof fetch = async () =>
      responseFromChunks([utf8Chunk('abc'), utf8Chunk('def')]);
    const exactTransport = createSolanaRpcTransport(
      transportOptions(exact, { maxResponseBytes: 6 }),
    );
    expect(await exactTransport(transportRequest())).toEqual('abcdef');

    const over: typeof fetch = async () =>
      responseFromChunks([utf8Chunk('abc'), utf8Chunk('defg')]);
    const overTransport = createSolanaRpcTransport(transportOptions(over, { maxResponseBytes: 6 }));
    await expect(overTransport(transportRequest())).rejects.toThrow(
      'SOLANA_RPC_RESPONSE_TOO_LARGE',
    );
  });

  /**
   * @target createSolanaRpcTransport decodes a multibyte character split across chunks
   * @dependencies one valid raw response with a multibyte scalar split between stream chunks
   * @scenario divide one UTF-8 sequence between adjacent response body chunks
   * @expected reassembly before fatal decoding preserves the exact source text
   */
  it('createSolanaRpcTransport decodes a multibyte character split across chunks', async () => {
    const raw = '{"jsonrpc":"2.0","id":1,"result":{"é":0}}';
    const encoded = utf8Chunk(raw);
    const split = encoded.indexOf(0xc3) + 1;
    const fetchImpl: typeof fetch = async () =>
      responseFromChunks([encoded.slice(0, split), encoded.slice(split)]);
    const transport = createSolanaRpcTransport(
      transportOptions(fetchImpl, {
        maxResponseBytes: 128,
        maxRequestBytes: 128,
      }),
    );

    expect(await transport(transportRequest())).toEqual(raw);
  });

  /**
   * @target createSolanaRpcTransport snapshots reused response buffers
   * @dependencies one response stream that mutates and re-enqueues the same Uint8Array
   * @scenario read two distinct one-byte chunks backed by a reused mutable buffer
   * @expected the returned text preserves the bytes observed at each read
   */
  it('createSolanaRpcTransport snapshots reused response buffers', async () => {
    const reused = utf8Chunk('A');
    let step = 0;
    const reader = {
      async read(): Promise<ReadableStreamReadResult<Uint8Array>> {
        if (step === 0) {
          step += 1;
          return { done: false, value: new Uint8Array() };
        }
        if (step === 1) {
          step += 1;
          return { done: false, value: reused };
        }
        if (step === 2) {
          reused.set(utf8Chunk('B'));
          step += 1;
          return { done: false, value: reused };
        }
        return { done: true, value: undefined };
      },
      async cancel(): Promise<void> {},
      releaseLock(): void {},
    };
    const body = {
      getReader: () => reader,
    } as unknown as ReadableStream<Uint8Array>;
    const fetchImpl: typeof fetch = async () =>
      ({
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        body,
      }) as Response;
    const transport = createSolanaRpcTransport(
      transportOptions(fetchImpl, { maxResponseBytes: 2 }),
    );
    expect(await transport(transportRequest())).toEqual('AB');
  });

  /**
   * @target createSolanaRpcTransport uses fatal UTF-8 decoding and leaves BOM policy to the parser
   * @dependencies invalid UTF-8 bytes and one UTF-8 BOM prepended to a valid JSON-RPC response
   * @scenario decode malformed bytes, then pass BOM-prefixed text through the existing caller
   * @expected malformed encoding gets a transport code while JSON parsing decides the BOM is invalid
   */
  it('createSolanaRpcTransport uses fatal UTF-8 decoding and leaves BOM policy to the parser', async () => {
    const invalidUtf8: typeof fetch = async () =>
      responseFromChunks([new Uint8Array([0xc3, 0x28])]);
    const invalidTransport = createSolanaRpcTransport(transportOptions(invalidUtf8));
    await expect(invalidTransport(transportRequest())).rejects.toThrow('SOLANA_RPC_INVALID_UTF8');

    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8Chunk(successfulResponseTexts[0])]);
    const bomFetch: typeof fetch = async () => responseFromChunks([bom]);
    const bomTransport = createSolanaRpcTransport(
      transportOptions(bomFetch, {
        maxRequestBytes: 256,
        maxResponseBytes: 256,
      }),
    );
    const raw = await bomTransport(transportRequest());
    expect(raw.charCodeAt(0)).toEqual(0xfeff);
    await expect(createRpcCaller(bomTransport)('getBalance', ['wallet'])).rejects.toThrow(
      'SOLANA_RPC_INVALID_JSON',
    );
  });

  /**
   * @target createSolanaRpcTransport times out while waiting for headers and response bytes
   * @dependencies one fetch that never returns headers and one response whose body read never resolves
   * @scenario let each request exceed its short explicit timeout at a different network phase
   * @expected both failures return the stable timeout code without waiting for source cleanup
   */
  it('createSolanaRpcTransport times out while waiting for headers and response bytes', async () => {
    const pendingFetch: typeof fetch = async () => unresolvedResponse();
    const headerTransport = createSolanaRpcTransport(
      transportOptions(pendingFetch, { timeoutMs: 15 }),
    );
    await expect(headerTransport(transportRequest())).rejects.toThrow(
      'SOLANA_RPC_TRANSPORT_TIMEOUT',
    );

    let cancellationStarted = false;
    const pendingBody: typeof fetch = async () => {
      const body = new ReadableStream<Uint8Array>({
        pull() {
          return new Promise(() => undefined);
        },
        cancel() {
          cancellationStarted = true;
          return new Promise(() => undefined);
        },
      });
      return new Response(body, {
        headers: { 'content-type': 'application/json' },
      });
    };
    const bodyTransport = createSolanaRpcTransport(
      transportOptions(pendingBody, { timeoutMs: 15 }),
    );
    const startedAt = Date.now();
    await expect(bodyTransport(transportRequest())).rejects.toThrow('SOLANA_RPC_TRANSPORT_TIMEOUT');
    expect(Date.now() - startedAt < 500).toEqual(true);
    await Promise.resolve();
    expect(cancellationStarted).toEqual(true);
  });

  /**
   * @target createSolanaRpcTransport propagates cancellation and cleans up the signal listener
   * @dependencies one unresolved injected fetch and a structural signal recording listener ownership
   * @scenario abort the signal after headers are requested but before the fetch resolves
   * @expected the same reason rejects immediately and the registered listener is removed once
   */
  it('createSolanaRpcTransport propagates cancellation and cleans up the signal listener', async () => {
    let listener: (() => void) | undefined;
    let added = 0;
    let removed = 0;
    const fakeSignal = {
      aborted: false,
      reason: undefined as unknown,
      addEventListener: vi.fn((_type: string, callback: EventListenerOrEventListenerObject) => {
        added += 1;
        listener = callback as () => void;
      }),
      removeEventListener: vi.fn(() => {
        removed += 1;
      }),
    } as unknown as AbortSignal;
    const fetchImpl: typeof fetch = async () => unresolvedResponse();
    const transport = createSolanaRpcTransport(transportOptions(fetchImpl, { signal: fakeSignal }));
    const pending = transport(transportRequest());
    const reason = new Error('caller cancelled');
    Object.defineProperty(fakeSignal, 'aborted', { value: true });
    Object.defineProperty(fakeSignal, 'reason', { value: reason });
    listener?.();

    await expect(pending).rejects.toBe(reason);
    expect(added).toEqual(1);
    expect(removed).toEqual(1);
  });

  /**
   * @target createSolanaRpcTransport preserves network errors and cancels a late response
   * @dependencies one injected network error and one fetch that resolves with a stream after timeout
   * @scenario reject before headers, then allow another timed-out fetch to resolve later
   * @expected the original error object escapes and the late body is canceled without being read
   */
  it('createSolanaRpcTransport preserves network errors and cancels a late response', async () => {
    const networkError = new Error('local fetch failure');
    const rejecting: typeof fetch = async () => {
      throw networkError;
    };
    const rejectingTransport = createSolanaRpcTransport(transportOptions(rejecting));
    await expect(rejectingTransport(transportRequest())).rejects.toBe(networkError);

    let resolveFetch: ((response: Response) => void) | undefined;
    let canceled = false;
    const lateFetch: typeof fetch = async () =>
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    const lateTransport = createSolanaRpcTransport(transportOptions(lateFetch, { timeoutMs: 15 }));
    await expect(lateTransport(transportRequest())).rejects.toThrow('SOLANA_RPC_TRANSPORT_TIMEOUT');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(utf8Chunk(successfulResponseTexts[0]));
      },
      cancel() {
        canceled = true;
        return new Promise(() => undefined);
      },
    });
    resolveFetch?.(new Response(body, { headers: { 'content-type': 'application/json' } }));
    await Promise.resolve();
    await Promise.resolve();
    expect(canceled).toEqual(true);
  });

  /**
   * @target createSolanaRpcTransport leaves response-envelope policy to createRpcCaller
   * @dependencies exact invalid response envelopes and the existing parser's correlation checks
   * @scenario return one duplicate-key body and one mismatched-id body from local fetch
   * @expected the transport returns text and createRpcCaller applies its unchanged envelope errors
   */
  it('createSolanaRpcTransport leaves response-envelope policy to createRpcCaller', async () => {
    const badResponses = [
      {
        raw: '{"jsonrpc":"2.0","id":1,"id":1,"result":null}',
        error: 'SOLANA_RPC_DUPLICATE_JSON_KEY',
      },
      {
        raw: '{"jsonrpc":"2.0","id":2,"result":null}',
        error: 'SOLANA_RPC_ID_MISMATCH',
      },
    ] as const;
    for (const { raw, error } of badResponses) {
      let callCount = 0;
      const fetchImpl: typeof fetch = async () => {
        callCount += 1;
        return responseFromChunks([utf8Chunk(raw)]);
      };
      const caller = createRpcCaller(
        createSolanaRpcTransport(
          transportOptions(fetchImpl, {
            maxRequestBytes: 256,
            maxResponseBytes: 256,
          }),
        ),
      );
      await expect(caller('getBalance', ['wallet'])).rejects.toThrow(error);
      expect(callCount).toEqual(1);
    }
  });
});
