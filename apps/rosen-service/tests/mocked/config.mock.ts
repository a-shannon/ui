import { vi } from 'vitest';

/** Node-config API double with no optional Avalanche policy at initial import. */
export const serviceConfigMock = (() => {
  const values = new Map<string, unknown>();
  return {
    values,
    get: vi.fn((key: string): unknown => values.get(key)),
    has: vi.fn((key: string) => values.has(key)),
  };
})();

/** Replace selected configuration values and clear prior API observations. */
export const mockServiceConfig = (values: Record<string, unknown>) => {
  serviceConfigMock.values.clear();
  for (const [key, value] of Object.entries(values)) serviceConfigMock.values.set(key, value);
  serviceConfigMock.get.mockClear();
  serviceConfigMock.has.mockClear();
};
