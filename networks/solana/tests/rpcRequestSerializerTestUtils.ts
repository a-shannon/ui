import { expect } from 'vitest';

import type { SolanaRpcRequest } from '@rosen-network/solana';

/** Verifies a stable protocol code while preserving Vitest's own failure on absence. */
export const expectProtocolError = (action: () => unknown, code: string): void => {
  expect(action).toThrow(code);
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toEqual(code);
};

/** Builds one ordinary request envelope with caller-supplied positional parameters. */
export const rpcRequest = (params: readonly unknown[] = []): SolanaRpcRequest => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'getBalance',
  params,
});

/** Builds a nested array parameter with one scalar leaf at the requested array depth. */
export const nestedArrayParameter = (depth: number): readonly unknown[] => {
  let value: unknown = 0;
  for (let index = 0; index < depth; index += 1) value = [value];
  return [value];
};

/** Builds one dense null parameter array of the requested length. */
export const nullParameters = (length: number): readonly null[] => Array(length).fill(null);
