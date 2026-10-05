import { validateAddress } from '@rosen-bridge/address-codec';

export interface AvalancheEndpoint {
  readonly sourceId: string;
  readonly url: string;
  readonly timeoutMs: number;
  readonly authToken?: string;
}

export interface AvalancheServiceConfig {
  readonly chainId: 43113 | 43114;
  readonly initialHeight: number;
  readonly selectedSourceId: string;
  readonly endpoints: readonly AvalancheEndpoint[];
  readonly addresses: Readonly<{
    lock: string;
    eventTrigger: string;
    permit: string;
    fraud: string;
    commitment: string;
  }>;
  readonly tokens: Readonly<{ rwt: string }>;
  readonly calculatorAddresses: readonly string[];
  readonly intervalMs: number;
  readonly health: Readonly<{ warnDiff: number; criticalDiff: number; blockTime: number }>;
}

/** Require a plain configuration object without accepting arrays or null. */
const record = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid Avalanche ${label}`);
  }
  return value as Record<string, unknown>;
};

/** Require an explicitly supplied nonempty string. */
const string = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error(`Invalid Avalanche ${label}`);
  }
  return value;
};

/** Require an integer inside the declared operational range. */
const integer = (value: unknown, label: string, minimum: number, maximum = 2_147_483_647) => {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`Invalid Avalanche ${label}`);
  }
  return value;
};

/** Validate an address using the chain codec and reject the zero EVM address. */
const address = (value: unknown, chain: 'avalanche' | 'ergo', label: string) => {
  const result = string(value, label);
  validateAddress(chain, result);
  if (chain === 'avalanche' && /^0x0{40}$/i.test(result)) {
    throw new Error(`Invalid Avalanche ${label}`);
  }
  return result;
};

/** Parse explicit deployment policy; absent configuration leaves Avalanche disabled. */
export const parseAvalancheConfig = (
  value: unknown,
  healthCheck?: unknown,
): AvalancheServiceConfig | undefined => {
  if (value === undefined) return undefined;
  const config = record(value, 'configuration');
  if (config.enabled === false && Object.keys(config).length === 1) return undefined;
  if (config.enabled !== true)
    throw new Error('Avalanche activation must be explicit and complete');
  if (config.chainId !== 43113 && config.chainId !== 43114) {
    throw new Error('Avalanche chainId must be 43113 or 43114');
  }
  const selectedSourceId = string(config.selectedSourceId, 'selectedSourceId');
  if (!Array.isArray(config.endpoints) || config.endpoints.length < 2) {
    throw new Error('Avalanche requires at least two independently operated endpoints');
  }
  const endpoints = config.endpoints.map((value) => {
    const endpoint = record(value, 'endpoint');
    const sourceId = string(endpoint.sourceId, 'sourceId');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(sourceId)) {
      throw new Error('Invalid Avalanche sourceId');
    }
    const url = string(endpoint.url, 'endpoint URL');
    const parsed = new URL(url);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    ) {
      throw new Error('Invalid Avalanche endpoint URL');
    }
    const timeoutMs = integer(endpoint.timeoutMs, 'endpoint timeoutMs', 1);
    const authToken =
      endpoint.authToken === undefined ? undefined : string(endpoint.authToken, 'authToken');
    return Object.freeze({ sourceId, url, timeoutMs, authToken });
  });
  if (
    new Set(endpoints.map((endpoint) => endpoint.sourceId)).size !== endpoints.length ||
    new Set(endpoints.map((endpoint) => new URL(endpoint.url).hostname.toLowerCase())).size !==
      endpoints.length
  ) {
    throw new Error('Avalanche endpoints must have distinct identities and hosts');
  }
  if (!endpoints.some((endpoint) => endpoint.sourceId === selectedSourceId)) {
    throw new Error('Avalanche selectedSourceId is not configured');
  }
  const addresses = record(config.addresses, 'addresses');
  const tokens = record(config.tokens, 'tokens');
  const rwt = string(tokens.rwt, 'RWT');
  if (!/^[a-fA-F0-9]{64}$/.test(rwt) || /^0{64}$/.test(rwt))
    throw new Error('Invalid Avalanche RWT');
  if (!Array.isArray(config.calculatorAddresses) || config.calculatorAddresses.length === 0) {
    throw new Error('Avalanche calculatorAddresses are required');
  }
  const calculatorAddresses = config.calculatorAddresses.map((value) =>
    address(value, 'avalanche', 'calculator address'),
  );
  if (
    new Set(calculatorAddresses.map((value) => value.toLowerCase())).size !==
    calculatorAddresses.length
  ) {
    throw new Error('Duplicate Avalanche calculator address');
  }
  const health = record(config.health, 'health policy');
  if ('warnDiff' in health || 'criticalDiff' in health) {
    throw new Error('Avalanche scanner thresholds must be configured under healthCheck');
  }
  const scannerHealth = record(healthCheck, 'scanner health policy');
  const warnDiff = integer(scannerHealth.avalancheScannerWarnDiff, 'scanner warnDiff', 1);
  const criticalDiff = integer(
    scannerHealth.avalancheScannerCriticalDiff,
    'scanner criticalDiff',
    warnDiff + 1,
  );
  if (
    typeof health.blockTime !== 'number' ||
    !Number.isFinite(health.blockTime) ||
    health.blockTime <= 0
  ) {
    throw new Error('Invalid Avalanche blockTime');
  }
  return Object.freeze({
    chainId: config.chainId,
    initialHeight: integer(config.initialHeight, 'initialHeight', -1, 2_147_483_646),
    selectedSourceId,
    endpoints: Object.freeze(endpoints),
    addresses: Object.freeze({
      lock: address(addresses.lock, 'avalanche', 'lock address'),
      eventTrigger: address(addresses.eventTrigger, 'ergo', 'event trigger address'),
      permit: address(addresses.permit, 'ergo', 'permit address'),
      fraud: address(addresses.fraud, 'ergo', 'fraud address'),
      commitment: address(addresses.commitment, 'ergo', 'commitment address'),
    }),
    tokens: Object.freeze({ rwt }),
    calculatorAddresses: Object.freeze(calculatorAddresses),
    intervalMs: integer(config.intervalMs, 'intervalMs', 1),
    health: Object.freeze({ warnDiff, criticalDiff, blockTime: health.blockTime }),
  });
};

/** Resolve the pinned endpoint without silently falling back to another identity. */
export const selectedAvalancheEndpoint = (config: AvalancheServiceConfig): AvalancheEndpoint => {
  const endpoint = config.endpoints.find(
    (endpoint) => endpoint.sourceId === config.selectedSourceId,
  );
  if (!endpoint) throw new Error('Avalanche selected source is missing');
  return endpoint;
};
