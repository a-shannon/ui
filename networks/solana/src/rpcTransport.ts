import type { SolanaRpcRequest, SolanaRpcTransport } from './rpcProtocol';
import { serializeSolanaRpcRequest } from './rpcRequestSerializer';

const PARSER_MAX_RESPONSE_BYTES = 1_048_576;

export interface SolanaRpcTransportOptions {
  readonly endpointURL: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly maxRequestBytes: number;
  readonly fetchImpl: typeof fetch;
  readonly signal?: AbortSignal;
}

interface CapturedOptions {
  readonly endpointURL: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly maxRequestBytes: number;
  readonly fetchImpl: typeof fetch;
  readonly signal?: AbortSignal;
}

/** Throws one stable transport error without echoing endpoint or response data. */
const fail = (code: string): never => {
  throw new Error(code);
};

/** Copies exactly the own option fields without invoking accessors. */
const captureOptions = (value: SolanaRpcTransportOptions): CapturedOptions => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return fail('SOLANA_RPC_TRANSPORT_CONFIG_INVALID');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    return fail('SOLANA_RPC_TRANSPORT_CONFIG_INVALID');
  const keys = Reflect.ownKeys(value);
  const required = ['endpointURL', 'timeoutMs', 'maxResponseBytes', 'maxRequestBytes', 'fetchImpl'];
  if (keys.length !== required.length && keys.length !== required.length + 1)
    return fail('SOLANA_RPC_TRANSPORT_CONFIG_INVALID');
  if (
    keys.some((key) => typeof key !== 'string' || (!required.includes(key) && key !== 'signal')) ||
    required.some((key) => !keys.includes(key))
  )
    return fail('SOLANA_RPC_TRANSPORT_CONFIG_INVALID');
  const record: Record<string, unknown> = {};
  for (const key of keys) {
    if (typeof key !== 'string') return fail('SOLANA_RPC_TRANSPORT_CONFIG_INVALID');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)
      return fail('SOLANA_RPC_TRANSPORT_CONFIG_INVALID');
    record[key] = descriptor.value;
  }
  if (typeof record.endpointURL !== 'string' || record.endpointURL.length === 0)
    return fail('SOLANA_RPC_ENDPOINT_INVALID');
  let endpointURL: URL;
  try {
    if (record.endpointURL !== record.endpointURL.trim() || record.endpointURL.includes('#'))
      return fail('SOLANA_RPC_ENDPOINT_INVALID');
    endpointURL = new URL(record.endpointURL);
  } catch {
    return fail('SOLANA_RPC_ENDPOINT_INVALID');
  }
  if (
    (endpointURL.protocol !== 'http:' && endpointURL.protocol !== 'https:') ||
    endpointURL.username !== '' ||
    endpointURL.password !== '' ||
    endpointURL.hash !== ''
  )
    return fail('SOLANA_RPC_ENDPOINT_INVALID');
  if (
    !Number.isSafeInteger(record.timeoutMs) ||
    (record.timeoutMs as number) < 1 ||
    (record.timeoutMs as number) > 2_147_483_647
  )
    return fail('SOLANA_RPC_TRANSPORT_CONFIG_INVALID');
  for (const field of ['maxResponseBytes', 'maxRequestBytes'] as const) {
    const limit = record[field];
    if (
      !Number.isSafeInteger(limit) ||
      (limit as number) < 1 ||
      (limit as number) > PARSER_MAX_RESPONSE_BYTES
    )
      return fail('SOLANA_RPC_TRANSPORT_CONFIG_INVALID');
  }
  if (typeof record.fetchImpl !== 'function') return fail('SOLANA_RPC_TRANSPORT_CONFIG_INVALID');
  const signal = record.signal;
  if (
    signal !== undefined &&
    (typeof signal !== 'object' ||
      signal === null ||
      typeof (signal as AbortSignal).aborted !== 'boolean' ||
      typeof (signal as AbortSignal).addEventListener !== 'function' ||
      typeof (signal as AbortSignal).removeEventListener !== 'function')
  )
    return fail('SOLANA_RPC_TRANSPORT_CONFIG_INVALID');
  return {
    endpointURL: endpointURL.href,
    timeoutMs: record.timeoutMs as number,
    maxResponseBytes: record.maxResponseBytes as number,
    maxRequestBytes: record.maxRequestBytes as number,
    fetchImpl: record.fetchImpl as typeof fetch,
    ...(signal === undefined ? {} : { signal: signal as AbortSignal }),
  };
};

/** Cancels a stream without waiting for an uncooperative source to finish cleanup. */
const cancelWithoutWaiting = (stream: ReadableStream<Uint8Array> | null, reason: unknown): void => {
  if (!stream) return;
  try {
    void stream.cancel(reason).catch(() => undefined);
  } catch {
    // Preserve the primary transport failure if stream cleanup itself fails.
  }
};

/** Accepts JSON media types while allowing an absent type for parser-level handling. */
const requireJsonContentType = (response: Response): void => {
  const value = response.headers.get('content-type');
  if (value === null) return;
  const mediaType = value.split(';', 1)[0].trim().toLowerCase();
  if (
    mediaType !== 'application/json' &&
    !/^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(mediaType)
  ) {
    cancelWithoutWaiting(response.body, new Error('SOLANA_RPC_CONTENT_TYPE_INVALID'));
    fail('SOLANA_RPC_CONTENT_TYPE_INVALID');
  }
};

/** Reads a bounded response body before allocating one contiguous buffer or decoding text. */
const readBoundedBody = async (
  response: Response,
  maximumBytes: number,
  assertActive: () => void,
  setCancel: (cancel: ((reason: unknown) => void) | null) => void,
): Promise<string> => {
  if (!response.body) return '';
  const reader = response.body.getReader();
  let cancelled = false;
  let finished = false;
  /** Cancels the response reader at most once without allowing cleanup errors to replace the cause. */
  const cancel = (reason: unknown): void => {
    if (cancelled || finished) return;
    cancelled = true;
    try {
      void reader.cancel(reason).catch(() => undefined);
    } catch {
      // Cleanup must not replace the error which caused cancellation.
    }
  };
  setCancel(cancel);
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      assertActive();
      const next = await reader.read();
      assertActive();
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) fail('SOLANA_RPC_RESPONSE_BODY_INVALID');
      if (next.value.byteLength > maximumBytes - totalBytes) fail('SOLANA_RPC_RESPONSE_TOO_LARGE');
      if (next.value.byteLength === 0) continue;
      totalBytes += next.value.byteLength;
      chunks.push(next.value.slice());
    }
    finished = true;
    setCancel(null);
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      return fail('SOLANA_RPC_INVALID_UTF8');
    }
  } catch (error) {
    cancel(error);
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A pending uncooperative read may still hold the lock after the deadline.
    }
  }
};

/** Creates one explicit-endpoint, bounded, no-retry browser JSON-RPC transport. */
export const createSolanaRpcTransport = (
  options: SolanaRpcTransportOptions,
): SolanaRpcTransport => {
  const captured = captureOptions(options);
  return async (request: SolanaRpcRequest): Promise<string> => {
    const { signal } = captured;
    if (signal?.aborted) throw signal.reason;
    const controller = new AbortController();
    const activeCancellation: { current: ((reason: unknown) => void) | null } = { current: null };
    let rejectDeadline: (reason?: unknown) => void = () => undefined;
    const deadline = new Promise<never>((_, reject) => {
      rejectDeadline = reject;
    });
    /** Propagates caller cancellation to the deadline race and the active fetch/body read. */
    const onAbort = (): void => {
      const reason = signal?.reason;
      rejectDeadline(reason);
      controller.abort(reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      const timeout = new Error('SOLANA_RPC_TRANSPORT_TIMEOUT');
      rejectDeadline(timeout);
      controller.abort(timeout);
    }, captured.timeoutMs);
    /** Throws the active abort or deadline reason before the operation continues. */
    const assertActive = (): void => {
      if (controller.signal.aborted) throw controller.signal.reason;
    };
    /** Sends one bounded RPC request and validates the HTTP response and body. */
    const operation = async (): Promise<string> => {
      const body = serializeSolanaRpcRequest(request, captured.maxRequestBytes);
      assertActive();
      const response = await captured.fetchImpl(captured.endpointURL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body,
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        cancelWithoutWaiting(response.body, controller.signal.reason);
        throw controller.signal.reason;
      }
      if (response.status < 200 || response.status >= 300) {
        cancelWithoutWaiting(response.body, new Error('SOLANA_RPC_HTTP_ERROR'));
        fail('SOLANA_RPC_HTTP_ERROR');
      }
      requireJsonContentType(response);
      return readBoundedBody(response, captured.maxResponseBytes, assertActive, (cancel) => {
        activeCancellation.current = cancel;
      });
    };
    try {
      return await Promise.race([operation(), deadline]);
    } catch (error) {
      if (!controller.signal.aborted) controller.abort(error);
      activeCancellation.current?.(error);
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  };
};
