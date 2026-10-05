import { expect } from 'vitest';

/** Checks one protocol failure against its exact stable error code. */
export const expectProtocolError = (action: () => unknown, code: string): void => {
  let caught: unknown;
  /** Captures the same thrown error for exact-code verification after Vitest asserts it is thrown. */
  const captureError = () => {
    try {
      return action();
    } catch (error) {
      caught = error;
      throw error;
    }
  };
  expect(captureError).toThrow(code);
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toEqual(code);
};

/** Wraps an already-serialized result without converting its numeric lexemes. */
export const rawRpcResponse = (id: number, result: string): string =>
  `{"jsonrpc":"2.0","id":${id},"result":${result}}`;

/** Builds one bounded JSON array with a root node and the requested scalar count. */
export const nullArrayWithNodes = (scalarCount: number): string =>
  `[${Array(scalarCount).fill('null').join(',')}]`;

/** Builds nested arrays whose innermost scalar is at the requested parser depth. */
export const nestedArrayAtDepth = (depth: number): string =>
  `${'['.repeat(depth)}0${']'.repeat(depth)}`;
