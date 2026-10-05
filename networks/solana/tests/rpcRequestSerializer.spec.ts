import { describe, expect, it, vi } from 'vitest';

import { serializeSolanaRpcRequest } from '@rosen-network/solana';

import {
  invalidRequestNumberCases,
  requestDepthCases,
  requestU64Cases,
} from './rpcRequestSerializerTestData';
import {
  expectProtocolError,
  nestedArrayParameter,
  nullParameters,
  rpcRequest,
} from './rpcRequestSerializerTestUtils';

describe('serializeSolanaRpcRequest', () => {
  /**
   * @target serializeSolanaRpcRequest emits $name as an exact number lexeme
   * @dependencies exact raw u64 fixture values and a standard request envelope
   * @scenario serialize each BigInt parameter and inspect the raw method body
   * @expected the body contains the original base-ten integer without a Number conversion
   */
  it.each(requestU64Cases)(
    'serializeSolanaRpcRequest emits $name as an exact number lexeme',
    ({ value, lexeme }) => {
      const body = serializeSolanaRpcRequest(rpcRequest([value]), 256);
      expect(body).toEqual(`{"jsonrpc":"2.0","id":1,"method":"getBalance","params":[${lexeme}]}`);
    },
  );

  /**
   * @target serializeSolanaRpcRequest leaves marker-like strings literal
   * @dependencies string data that resembles an integer placeholder and JSON escape sequences
   * @scenario serialize the string beside a true BigInt parameter
   * @expected the marker remains a JSON string and the BigInt alone is emitted as a number token
   */
  it('serializeSolanaRpcRequest leaves marker-like strings literal', () => {
    const marker = '__BIGINT_9007199254740993__ "quoted" \\ path';
    const body = serializeSolanaRpcRequest(rpcRequest([marker, 9007199254740993n]), 256);
    expect(body).toEqual(
      '{"jsonrpc":"2.0","id":1,"method":"getBalance","params":["__BIGINT_9007199254740993__ \\"quoted\\" \\\\ path",9007199254740993]}',
    );
  });

  /**
   * @target serializeSolanaRpcRequest rejects $name
   * @dependencies non-negative safe-integer requirements for JSON numeric parameters
   * @scenario place each unsupported Number value in an ordinary parameter array
   * @expected every unsupported value fails with the same stable request-number code
   */
  it.each(invalidRequestNumberCases)('serializeSolanaRpcRequest rejects $name', ({ value }) => {
    expectProtocolError(
      () => serializeSolanaRpcRequest(rpcRequest([value]), 256),
      'SOLANA_RPC_INVALID_REQUEST_NUMBER',
    );
  });

  /**
   * @target serializeSolanaRpcRequest rejects BigInts outside u64
   * @dependencies one BigInt below zero and one above the Solana unsigned 64-bit range
   * @scenario serialize each out-of-domain integer as a parameter value
   * @expected negative values fail as invalid u64 and values above the maximum fail as out of range
   */
  it('serializeSolanaRpcRequest rejects BigInts outside u64', () => {
    expectProtocolError(
      () => serializeSolanaRpcRequest(rpcRequest([-1n]), 256),
      'SOLANA_RPC_INVALID_U64',
    );
    expectProtocolError(
      () => serializeSolanaRpcRequest(rpcRequest([18446744073709551616n]), 256),
      'SOLANA_RPC_U64_OUT_OF_RANGE',
    );
  });

  /**
   * @target serializeSolanaRpcRequest rejects malformed request envelopes
   * @dependencies request fixtures with one isolated envelope field defect
   * @scenario vary version, id, method, params and extra own fields independently
   * @expected each malformed envelope is rejected before JSON serialization
   */
  it('serializeSolanaRpcRequest rejects malformed request envelopes', () => {
    expect(() =>
      serializeSolanaRpcRequest({ ...rpcRequest(), jsonrpc: '1.0' } as never, 256),
    ).toThrow('SOLANA_RPC_INVALID_REQUEST');
    expect(() => serializeSolanaRpcRequest({ ...rpcRequest(), id: 0 }, 256)).toThrow(
      'SOLANA_RPC_INVALID_REQUEST_ID',
    );
    expect(() => serializeSolanaRpcRequest({ ...rpcRequest(), method: '' }, 256)).toThrow(
      'SOLANA_RPC_INVALID_REQUEST_METHOD',
    );
    expect(() =>
      serializeSolanaRpcRequest({ ...rpcRequest(), params: null } as never, 256),
    ).toThrow('SOLANA_RPC_INVALID_REQUEST_PARAMS');
    expect(() => serializeSolanaRpcRequest({ ...rpcRequest(), extra: true } as never, 256)).toThrow(
      'SOLANA_RPC_INVALID_REQUEST',
    );
  });

  /**
   * @target serializeSolanaRpcRequest refuses accessors without invoking them
   * @dependencies an own getter on a request object and an own getter in nested parameters
   * @scenario serialize each getter-bearing value while tracking getter execution
   * @expected the request is rejected and neither getter runs
   */
  it('serializeSolanaRpcRequest refuses accessors without invoking them', () => {
    const topLevel = Object.defineProperty(rpcRequest(), 'id', {
      enumerable: true,
      get: vi.fn(() => 1),
    });
    const nested = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: vi.fn(() => 1),
    });
    expect(() => serializeSolanaRpcRequest(topLevel, 256)).toThrow('SOLANA_RPC_INVALID_REQUEST');
    expect(() => serializeSolanaRpcRequest(rpcRequest([nested]), 256)).toThrow(
      'SOLANA_RPC_INVALID_REQUEST_VALUE',
    );
    expect(Object.getOwnPropertyDescriptor(topLevel, 'id')?.get).not.toHaveBeenCalled();
    expect(Object.getOwnPropertyDescriptor(nested, 'value')?.get).not.toHaveBeenCalled();
  });

  /**
   * @target serializeSolanaRpcRequest rejects unsupported object structures
   * @dependencies isolated non-JSON object shapes and a circular reference
   * @scenario serialize one parameter for each forbidden structure
   * @expected no custom object behavior is invoked or omitted from the JSON request
   */
  it('serializeSolanaRpcRequest rejects unsupported object structures', () => {
    const customPrototype = Object.assign(Object.create({ inherited: true }), {
      value: 1,
    });
    const symbolKey = { value: 1, [Symbol('hidden')]: 2 };
    const sparse = Array(1);
    const withToJSON = { toJSON: () => 'changed' };
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    for (const value of [customPrototype, symbolKey, withToJSON])
      expect(() => serializeSolanaRpcRequest(rpcRequest([value]), 256)).toThrow(
        'SOLANA_RPC_INVALID_REQUEST_VALUE',
      );
    expect(() => serializeSolanaRpcRequest(rpcRequest([sparse]), 256)).toThrow(
      'SOLANA_RPC_INVALID_REQUEST_ARRAY',
    );
    expect(() => serializeSolanaRpcRequest(rpcRequest([cyclic]), 256)).toThrow(
      'SOLANA_RPC_INVALID_REQUEST_CYCLE',
    );
  });

  /**
   * @target serializeSolanaRpcRequest enforces UTF-8 request-byte limits
   * @dependencies one Unicode request body and an independent TextEncoder byte count
   * @scenario serialize at its measured byte length and once with a one-byte-smaller cap
   * @expected exact-cap output succeeds and the smaller cap fails before any fetch boundary
   */
  it('serializeSolanaRpcRequest enforces UTF-8 request-byte limits', () => {
    const request = rpcRequest(['é']);
    const expected = '{"jsonrpc":"2.0","id":1,"method":"getBalance","params":["é"]}';
    const bytes = new TextEncoder().encode(expected).byteLength;
    expect(serializeSolanaRpcRequest(request, bytes)).toEqual(expected);
    expect(() => serializeSolanaRpcRequest(request, bytes - 1)).toThrow(
      'SOLANA_RPC_REQUEST_TOO_LARGE',
    );
  });

  /**
   * @target serializeSolanaRpcRequest measures escaped scalar bytes exactly
   * @dependencies strings containing JSON escapes, control characters, Unicode, and unpaired surrogates
   * @scenario compare exact-cap serialization with JSON.stringify's UTF-8 byte length for each string
   * @expected every exact cap succeeds and one byte less fails before producing a request
   */
  it('serializeSolanaRpcRequest measures escaped scalar bytes exactly', () => {
    const scalars = ['"\\', '\0', '\b\f\n\r\t', 'é', '😀', '\ud800', '\udc00', '\u2028'];
    for (const scalar of scalars) {
      const request = rpcRequest([scalar]);
      const expected = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBalance',
        params: [scalar],
      });
      const bytes = new TextEncoder().encode(expected).byteLength;
      expect(serializeSolanaRpcRequest(request, bytes)).toEqual(expected);
      expectProtocolError(
        () => serializeSolanaRpcRequest(request, bytes - 1),
        'SOLANA_RPC_REQUEST_TOO_LARGE',
      );
    }
  });

  /**
   * @target serializeSolanaRpcRequest checks a long scalar before JSON.stringify
   * @dependencies one overlong scalar, one NUL scalar whose raw length fits but escaped JSON does not, and an empty scalar with one byte remaining
   * @scenario spy on JSON.stringify while serializing over-budget string shapes and an empty string that cannot fit its quotes
   * @expected each request fails before JSON.stringify allocates a scalar that exceeds the remaining request budget
   */
  it('serializeSolanaRpcRequest checks a long scalar before JSON.stringify', () => {
    const large = 'x'.repeat(512);
    const controlScalar = '\0'.repeat(64);
    const prefix = '{"jsonrpc":"2.0","id":1,"method":"getBalance","params":[';
    const emptyStringMaximumBytes = new TextEncoder().encode(prefix).byteLength + 1;
    const remainingBytes = 128 - new TextEncoder().encode(prefix).byteLength;
    expect(controlScalar.length).toBeLessThanOrEqual(remainingBytes);
    expect(new TextEncoder().encode(JSON.stringify(controlScalar)).byteLength).toBeGreaterThan(
      remainingBytes,
    );
    const stringify = vi.spyOn(JSON, 'stringify');
    try {
      expectProtocolError(
        () => serializeSolanaRpcRequest(rpcRequest([large]), 128),
        'SOLANA_RPC_REQUEST_TOO_LARGE',
      );
      expectProtocolError(
        () => serializeSolanaRpcRequest(rpcRequest([controlScalar]), 128),
        'SOLANA_RPC_REQUEST_TOO_LARGE',
      );
      expectProtocolError(
        () => serializeSolanaRpcRequest(rpcRequest(['']), emptyStringMaximumBytes),
        'SOLANA_RPC_REQUEST_TOO_LARGE',
      );
      expect(stringify).not.toHaveBeenCalledWith(large);
      expect(stringify).not.toHaveBeenCalledWith(controlScalar);
      expect(stringify).not.toHaveBeenCalledWith('');
    } finally {
      stringify.mockRestore();
    }
  });

  /**
   * @target serializeSolanaRpcRequest enforces $name
   * @dependencies nested array parameter fixtures around the depth limit
   * @scenario serialize depth 64 and depth 65 nested values
   * @expected depth 64 succeeds and depth 65 fails with the exact request-depth code
   */
  it.each(requestDepthCases)(
    'serializeSolanaRpcRequest enforces $name',
    ({ nestedArrays, accepted }) => {
      const action = () =>
        serializeSolanaRpcRequest(rpcRequest(nestedArrayParameter(nestedArrays)), 1_048_576);
      if (accepted) {
        expect(action()).toEqual(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getBalance',
            params: nestedArrayParameter(nestedArrays),
          }),
        );
      } else {
        expectProtocolError(action, 'SOLANA_RPC_REQUEST_DEPTH_LIMIT');
      }
    },
  );

  /**
   * @target serializeSolanaRpcRequest enforces the complete node limit
   * @dependencies flat positional parameters counted with the root request node
   * @scenario serialize arrays that produce exactly 100000 and 100001 total value nodes
   * @expected the exact node cap succeeds and one more node fails specifically
   */
  it('serializeSolanaRpcRequest enforces the complete node limit', () => {
    expect(() =>
      serializeSolanaRpcRequest(rpcRequest(nullParameters(99_995)), 1_048_576),
    ).not.toThrow();
    expect(() => serializeSolanaRpcRequest(rpcRequest(nullParameters(99_996)), 1_048_576)).toThrow(
      'SOLANA_RPC_REQUEST_NODE_LIMIT',
    );
  });
});
