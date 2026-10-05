import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, expect, it } from 'vitest';

import { createRpcCaller, createSolanaRpcTransport } from '@rosen-network/solana';

import { transportOptions, transportRequest, utf8Chunk } from './rpcTransportTestUtils';

describe('createSolanaRpcTransport native HTTP join', () => {
  /**
   * @target createSolanaRpcTransport uses bounded native fetch against a local loopback server
   * @dependencies Node 22 native fetch and an ephemeral 127.0.0.1 server with deterministic fixture routes
   * @scenario send a large u64, receive malformed and oversized bodies, and stall headers or body bytes
   * @expected headers and exact request lexeme arrive once, parser errors stay downstream, and deadlines bound real fetch
   */
  it('createSolanaRpcTransport uses bounded native fetch against a local loopback server', async () => {
    let capturedBody = '';
    let capturedHeaders: Record<string, string | string[] | undefined> = {};
    const server = createServer((request, response) => {
      const mode = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams.get('mode');
      const chunks: Uint8Array[] = [];
      request.on('data', (chunk: Uint8Array | string) => {
        chunks.push(typeof chunk === 'string' ? utf8Chunk(chunk) : chunk);
      });
      request.on('end', () => {
        capturedBody = new TextDecoder().decode(
          Uint8Array.from(chunks.flatMap((chunk) => [...chunk])),
        );
        capturedHeaders = request.headers;
        if (mode === 'headers') return;
        response.writeHead(200, { 'content-type': 'application/json' });
        if (mode === 'body') {
          response.write('{"jsonrpc":"2.0","id":1,');
          return;
        }
        if (mode === 'oversize') {
          response.write('01234567890123456789');
          response.end();
          return;
        }
        if (mode === 'duplicate') {
          response.end('{"jsonrpc":"2.0","id":1,"id":1,"result":null}');
          return;
        }
        response.end('{"jsonrpc":"2.0","id":1,"result":null}');
      });
    });
    server.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address() as AddressInfo;
    const endpoint = (mode: string) => `http://127.0.0.1:${address.port}/rpc?mode=${mode}`;
    const nativeOptions = (
      mode: string,
      overrides: { timeoutMs?: number; maxResponseBytes?: number } = {},
    ) =>
      transportOptions(fetch, {
        endpointURL: endpoint(mode),
        maxRequestBytes: 256,
        maxResponseBytes: 256,
        ...overrides,
      });
    try {
      const success = createSolanaRpcTransport(nativeOptions('ok'));
      await createRpcCaller(success)('getBalance', [
        'wallet',
        { minContextSlot: 18_446_744_073_709_551_615n },
      ]);
      expect(capturedBody).toEqual(
        '{"jsonrpc":"2.0","id":1,"method":"getBalance","params":["wallet",{"minContextSlot":18446744073709551615}]}',
      );
      expect(capturedHeaders['content-type']).toEqual('application/json');
      expect(capturedHeaders.accept).toEqual('application/json');
      expect(capturedHeaders['content-length']).toEqual(
        String(new TextEncoder().encode(capturedBody).byteLength),
      );

      const duplicate = createRpcCaller(createSolanaRpcTransport(nativeOptions('duplicate')));
      await expect(duplicate('getBalance', ['wallet'])).rejects.toThrow(
        'SOLANA_RPC_DUPLICATE_JSON_KEY',
      );
      await expect(
        createSolanaRpcTransport(nativeOptions('oversize', { maxResponseBytes: 10 }))(
          transportRequest(),
        ),
      ).rejects.toThrow('SOLANA_RPC_RESPONSE_TOO_LARGE');
      await expect(
        createSolanaRpcTransport(nativeOptions('headers', { timeoutMs: 40 }))(transportRequest()),
      ).rejects.toThrow('SOLANA_RPC_TRANSPORT_TIMEOUT');
      await expect(
        createSolanaRpcTransport(nativeOptions('body', { timeoutMs: 40 }))(transportRequest()),
      ).rejects.toThrow('SOLANA_RPC_TRANSPORT_TIMEOUT');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
