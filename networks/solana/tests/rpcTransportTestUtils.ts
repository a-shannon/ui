import type { SolanaRpcRequest, SolanaRpcTransportOptions } from '@rosen-network/solana';

/** Builds one ordinary request envelope for an injected local fetch implementation. */
export const transportRequest = (method = 'getBalance'): SolanaRpcRequest => ({
  jsonrpc: '2.0',
  id: 1,
  method,
  params: ['wallet'],
});

/** Supplies explicit deterministic local endpoint and byte/time bounds for transport tests. */
export const transportOptions = (
  fetchImpl: typeof fetch,
  overrides: Partial<SolanaRpcTransportOptions> = {},
): SolanaRpcTransportOptions => ({
  endpointURL: 'https://rpc.example.invalid/solana?fixture=local',
  timeoutMs: 1000,
  maxResponseBytes: 128,
  maxRequestBytes: 128,
  fetchImpl,
  ...overrides,
});

/** Creates a response stream from explicit byte chunks and optional response metadata. */
export const responseFromChunks = (
  chunks: readonly Uint8Array[],
  options: {
    readonly status?: number;
    readonly contentType?: string | null;
    readonly cancel?: () => void;
  } = {},
): Response => {
  const headers = new Headers();
  if (options.contentType !== null)
    headers.set('content-type', options.contentType ?? 'application/json');
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
    cancel() {
      options.cancel?.();
    },
  });
  return new Response(body, { status: options.status ?? 200, headers });
};

/** Returns one byte-accurate UTF-8 chunk for a response fixture. */
export const utf8Chunk = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Holds an unresolved operation until a timeout or abort closes its transport request. */
export const unresolvedResponse = (): Promise<Response> => new Promise(() => undefined);
