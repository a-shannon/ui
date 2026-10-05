import { describe, expect, it, vi } from 'vitest';

import {
  createRpcCaller,
  integerValue,
  member,
  parseJson,
  readU64Value,
  response,
  stringValue,
} from '@rosen-network/solana';

import {
  depthLimitCases,
  invalidEnvelopeCases,
  invalidU64ValueCases,
  nodeLimitCases,
  responseByteLimitCases,
  u64ValueCases,
} from './rpcProtocolTestData';
import {
  expectProtocolError,
  nestedArrayAtDepth,
  nullArrayWithNodes,
  rawRpcResponse,
} from './rpcProtocolTestUtils';

describe('Solana JSON-RPC protocol parser', () => {
  describe('readU64Value', () => {
    /**
     * @target readU64Value preserves the $name u64 token
     * @dependencies exact raw JSON number lexemes and the standalone Guard-compatible parser
     * @scenario parse the integer token as JSON syntax, then read it directly from the AST
     * @expected the returned bigint exactly matches the source decimal, including values above Number.MAX_SAFE_INTEGER
     */
    it.each(u64ValueCases)('readU64Value preserves the $name u64 token', ({ lexeme, expected }) => {
      const parsed = response(rawRpcResponse(1, lexeme), 1);
      expect(readU64Value(parsed.result)).toEqual(expected);
      expect(parsed.raw).toEqual(rawRpcResponse(1, lexeme));
    });

    /**
     * @target readU64Value rejects a $name u64 token
     * @dependencies exact raw JSON numeric spellings and the standalone protocol parser
     * @scenario isolate fraction, exponent, negative and above-u64 spellings
     * @expected each spelling yields its exact stable invalid-u64 or out-of-range code
     */
    it.each(invalidU64ValueCases)('readU64Value rejects a $name u64 token', ({ lexeme, error }) => {
      const parsed = response(rawRpcResponse(1, lexeme), 1);
      expectProtocolError(() => readU64Value(parsed.result), error);
    });
  });

  describe('member', () => {
    /**
     * @target member preserves a null result node for the caller to interpret
     * @dependencies a static successful JSON-RPC result with context and null value
     * @scenario parse the response envelope and inspect the value node separately from u64 decoding
     * @expected null remains an atom with a null value and readU64Value refuses it as SOLANA_RPC_INVALID_U64
     */
    it('member preserves a null result node for the caller to interpret', () => {
      const raw = '{"jsonrpc":"2.0","id":1,"result":{"context":{"slot":0},"value":null}}';
      const parsed = response(raw, 1);
      const value = member(parsed.result, 'value');

      expect(value?.kind).toEqual('atom');
      expect(value?.kind === 'atom' ? value.value : undefined).toEqual(null);
      expectProtocolError(() => readU64Value(value), 'SOLANA_RPC_INVALID_U64');
    });
  });

  describe('response', () => {
    /**
     * @target response rejects the $name envelope
     * @dependencies one exact static response with a single duplicate, id or version defect
     * @scenario validate the complete envelope against request id 1
     * @expected only the corresponding stable duplicate-key, id-mismatch or version-mismatch code
     */
    it.each(invalidEnvelopeCases)('response rejects the $name envelope', ({ raw, error }) => {
      expectProtocolError(() => response(raw, 1), error);
    });
  });

  describe('parseJson', () => {
    /**
     * @target parseJson applies the UTF-8 response bound for $name
     * @dependencies valid static JSON with a multibyte character at the exact encoded-byte boundary
     * @scenario measure the fixture in UTF-8, then parse it without changing its raw numeric or string tokens
     * @expected exactly 1048576 bytes parse and 1048577 bytes fail specifically with SOLANA_RPC_RESPONSE_TOO_LARGE
     */
    it.each(responseByteLimitCases)(
      'parseJson applies the UTF-8 response bound for $name',
      ({ raw, byteLength, expectedKind, error }) => {
        expect(new TextEncoder().encode(raw).byteLength).toEqual(byteLength);
        if (error) {
          expectProtocolError(() => parseJson(raw), error);
          return;
        }

        expect(parseJson(raw).kind).toEqual(expectedKind);
      },
    );

    /**
     * @target parseJson rejects oversized ASCII before UTF-8 encoding
     * @dependencies a local encoder spy and an ASCII source one code unit above the response cap
     * @scenario replace only the encoder method, then parse the oversized input
     * @expected the byte-limit error is thrown and the encoder is never called
     */
    it('parseJson rejects oversized ASCII before UTF-8 encoding', () => {
      const encode = vi.spyOn(TextEncoder.prototype, 'encode');
      try {
        const raw = 'a'.repeat(1_048_577);
        expectProtocolError(() => parseJson(raw), 'SOLANA_RPC_RESPONSE_TOO_LARGE');
        expect(encode).not.toHaveBeenCalled();
      } finally {
        encode.mockRestore();
      }
    });

    /**
     * @target parseJson uses encoded bytes for the multibyte near-bound input
     * @dependencies one valid JSON fixture whose UTF-16 length is at the cap but UTF-8 size exceeds it
     * @scenario parse the one-byte-over multibyte fixture while observing TextEncoder
     * @expected encoding occurs and the response is rejected at the UTF-8 byte limit
     */
    it('parseJson uses encoded bytes for the multibyte near-bound input', () => {
      const fixture = responseByteLimitCases.find(({ byteLength }) => byteLength === 1_048_577);
      if (!fixture) throw new Error('Missing one-byte-over multibyte fixture');
      const encode = vi.spyOn(TextEncoder.prototype, 'encode');
      try {
        expect(fixture.raw.length).toEqual(1_048_576);
        expectProtocolError(() => parseJson(fixture.raw), 'SOLANA_RPC_RESPONSE_TOO_LARGE');
        expect(encode).toHaveBeenCalledOnce();
      } finally {
        encode.mockRestore();
      }
    });

    /**
     * @target parseJson enforces the nesting limit for $name
     * @dependencies independently generated nested-array source with a scalar leaf
     * @scenario parse depth 64 and depth 65 while remaining below byte and node caps
     * @expected depth 64 succeeds and depth 65 fails with SOLANA_RPC_DEPTH_LIMIT
     */
    it.each(depthLimitCases)(
      'parseJson enforces the nesting limit for $name',
      ({ depth, expectedKind, error }) => {
        const raw = nestedArrayAtDepth(depth);
        if (error) {
          expectProtocolError(() => parseJson(raw), error);
          return;
        }

        expect(parseJson(raw).kind).toEqual(expectedKind);
      },
    );

    /**
     * @target parseJson enforces the node limit for $name
     * @dependencies valid flat JSON arrays counted as one root plus scalar children
     * @scenario parse arrays containing exactly 100000 and 100001 total nodes
     * @expected 100000 nodes succeed and 100001 fail with SOLANA_RPC_NODE_LIMIT
     */
    it.each(nodeLimitCases)(
      'parseJson enforces the node limit for $name',
      ({ scalarCount, expectedKind, error }) => {
        const raw = nullArrayWithNodes(scalarCount);
        if (error) {
          expectProtocolError(() => parseJson(raw), error);
          return;
        }

        expect(parseJson(raw).kind).toEqual(expectedKind);
      },
    );
  });

  describe('integerValue', () => {
    /**
     * @target integerValue limits decoding to non-negative safe integer tokens
     * @dependencies exact parsed numeric nodes above and below JavaScript's safe-integer boundary
     * @scenario decode 9007199254740991 then try a fraction, exponent and 9007199254740992
     * @expected the safe integer is returned and malformed or unsafe tokens receive field-specific codes
     */
    it('integerValue limits decoding to non-negative safe integer tokens', () => {
      expect(integerValue(parseJson('9007199254740991'), 'slot')).toEqual(9007199254740991);
      expectProtocolError(() => integerValue(parseJson('1.5'), 'slot'), 'SOLANA_RPC_INVALID_SLOT');
      expectProtocolError(() => integerValue(parseJson('1e3'), 'slot'), 'SOLANA_RPC_INVALID_SLOT');
      expectProtocolError(
        () => integerValue(parseJson('9007199254740992'), 'slot'),
        'SOLANA_RPC_UNSAFE_SLOT',
      );
    });
  });

  describe('createRpcCaller', () => {
    /**
     * @target createRpcCaller allocates correlated immutable requests without an endpoint
     * @dependencies a local deterministic transport returning matching static JSON-RPC envelopes
     * @scenario issue two calls through one caller and record each request before returning its response
     * @expected ids advance from 1 to 2 and each request and params array remain frozen
     */
    it('createRpcCaller allocates correlated immutable requests without an endpoint', async () => {
      const requests: { id: number; params: readonly unknown[] }[] = [];
      const call = createRpcCaller(async (request) => {
        requests.push(request);
        return `{"jsonrpc":"2.0","id":${request.id},"result":null}`;
      });

      await call('getBlockHeight', []);
      await call('getBalance', ['wallet', { minContextSlot: 9007199254740993n }]);

      expect(requests.map(({ id }) => id)).toEqual([1, 2]);
      expect(requests.every(Object.isFrozen)).toEqual(true);
      expect(Object.isFrozen(requests[0].params)).toEqual(true);
      expect(requests[1].params).toEqual(['wallet', { minContextSlot: 9007199254740993n }]);
    });
  });

  describe('stringValue', () => {
    /**
     * @target stringValue reads only a JSON string node
     * @dependencies one parsed string node and one parsed null node
     * @scenario read the string and null members independently
     * @expected the string is returned and null produces undefined
     */
    it('stringValue reads only a JSON string node', () => {
      expect(stringValue(member(parseJson('{"result":"2.0"}'), 'result'))).toEqual('2.0');
      expect(stringValue(member(parseJson('{"result":null}'), 'result'))).toEqual(undefined);
    });
  });
});
