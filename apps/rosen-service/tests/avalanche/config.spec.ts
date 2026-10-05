import { describe, expect, it } from 'vitest';

import { parseAvalancheConfig, selectedAvalancheEndpoint } from '../../src/avalanche/config';
import { avalancheConfigData, avalancheHealthCheckData } from './testUtils';

describe('parseAvalancheConfig', () => {
  /**
   * @target parseAvalancheConfig leaves unconfigured Avalanche disabled
   * @dependencies None
   * @scenario Avalanche policy is absent or explicitly disabled
   * @expected No Avalanche consumer configuration is produced
   */
  it.each([undefined, { enabled: false }])('leaves unconfigured Avalanche disabled', (value) => {
    expect(parseAvalancheConfig(value)).toEqual(undefined);
  });
  /**
   * @target parseAvalancheConfig accepts explicit chain %s
   * @dependencies Address codec
   * @scenario Complete Fuji or mainnet policy is supplied
   * @expected Explicit identity and independently configured source are preserved
   */
  it.each([43113, 43114])('accepts explicit chain %s', (chainId) => {
    const result = parseAvalancheConfig(
      { ...avalancheConfigData(), chainId },
      avalancheHealthCheckData(),
    );
    expect(result?.chainId).toEqual(chainId);
    expect(result?.endpoints.length).toEqual(2);
    expect(result?.selectedSourceId).toEqual('provider-a');
  });
  /**
   * @target parseAvalancheConfig rejects malformed %s
   * @dependencies Address codec
   * @scenario Exactly one required field is malformed
   * @expected Activation fails before constructing consumers
   */
  it.each([
    ['enabled', undefined],
    ['chainId', 1],
    ['initialHeight', -2],
    ['initialHeight', 1.5],
    ['selectedSourceId', 'missing'],
    ['endpoints', []],
    ['tokens', { rwt: '00'.repeat(32) }],
    ['tokens', { rwt: 'bad' }],
    ['calculatorAddresses', []],
    ['intervalMs', 0],
    ['intervalMs', Number.NaN],
    ['health', { blockTime: 0 }],
  ])('rejects malformed %s', (key, value) => {
    expect(() =>
      parseAvalancheConfig(
        { ...avalancheConfigData(), [key as string]: value },
        avalancheHealthCheckData(),
      ),
    ).toThrow();
  });
  /**
   * @target parseAvalancheConfig rejects partial policy
   * @dependencies None
   * @scenario Partial or ambiguously disabled policy is supplied
   * @expected Policy is rejected instead of silently skipping activation fields
   */
  it.each([null, [], {}, { enabled: true }, { enabled: false, chainId: 43113 }])(
    'rejects partial policy',
    (value) => {
      expect(() => parseAvalancheConfig(value, avalancheHealthCheckData())).toThrow();
    },
  );
  /**
   * @target parseAvalancheConfig rejects malformed endpoint %s
   * @dependencies Address codec
   * @scenario A single endpoint field violates identity, transport or timeout policy
   * @expected Endpoint configuration fails closed
   */
  it.each([
    ['sourceId', 'bad/source'],
    ['sourceId', 'provider-b'],
    ['url', 'ftp://c.example.invalid'],
    ['url', 'https://b.example.invalid/other'],
    ['url', 'https://user:pass@c.example.invalid'],
    ['timeoutMs', 0],
    ['timeoutMs', 2_147_483_648],
    ['authToken', ''],
  ])('rejects malformed endpoint %s', (key, value) => {
    const config = avalancheConfigData();
    config.endpoints[0] = { ...config.endpoints[0], [key as string]: value };
    expect(() => parseAvalancheConfig(config, avalancheHealthCheckData())).toThrow();
  });
  /**
   * @target parseAvalancheConfig rejects invalid %s independently
   * @dependencies Address codec
   * @scenario A chain address is invalid or a calculator address is duplicated
   * @expected Configuration fails before querying funds
   */
  it.each(['lock', 'permit', 'duplicate'])('rejects invalid %s independently', (field) => {
    const config = avalancheConfigData();
    if (field === 'lock') config.addresses.lock = `0x${'00'.repeat(20)}`;
    if (field === 'permit') config.addresses.permit = 'bad';
    if (field === 'duplicate') config.calculatorAddresses.push(config.calculatorAddresses[0]);
    expect(() => parseAvalancheConfig(config, avalancheHealthCheckData())).toThrow();
  });
  /**
   * @target parseAvalancheConfig pins deployment and endpoint configuration
   * @dependencies Address codec
   * @scenario Caller mutates its input after parsing
   * @expected Consumer policy remains a frozen independent snapshot
   */
  it('pins deployment and endpoint configuration', () => {
    const input = avalancheConfigData();
    const healthCheck = avalancheHealthCheckData();
    const result = parseAvalancheConfig(input, healthCheck)!;
    input.endpoints[0].url = 'https://changed.example.invalid';
    input.addresses.lock = `0x${'44'.repeat(20)}`;
    input.calculatorAddresses[0] = input.addresses.lock;
    healthCheck.avalancheScannerWarnDiff = 1;
    healthCheck.avalancheScannerCriticalDiff = 2;
    expect(result.endpoints[0].url).toEqual('https://a.example.invalid/rpc');
    expect(result.addresses.lock).toEqual(`0x${'11'.repeat(20)}`);
    expect(result.calculatorAddresses).toEqual([`0x${'33'.repeat(20)}`]);
    expect(Object.isFrozen(result.endpoints[0])).toEqual(true);
    expect(result.health).toEqual({ warnDiff: 5, criticalDiff: 10, blockTime: 2 });
    expect(Object.isFrozen(result.health)).toEqual(true);
  });
  /**
   * @target parseAvalancheConfig rejects missing flat scanner thresholds
   * @dependencies Address codec
   * @scenario Enabled policy has no flat healthCheck object
   * @expected Configuration fails without a nested threshold fallback
   */
  it('rejects missing flat scanner thresholds', () => {
    expect(() => parseAvalancheConfig(avalancheConfigData())).toThrow();
  });
  /**
   * @target parseAvalancheConfig rejects invalid flat %s=%s
   * @dependencies Address codec
   * @scenario One flat scanner threshold is missing, noninteger, zero or not ordered
   * @expected Enabled configuration fails before creating a scanner
   */
  it.each([
    ['avalancheScannerWarnDiff', undefined],
    ['avalancheScannerWarnDiff', 0],
    ['avalancheScannerWarnDiff', 1.5],
    ['avalancheScannerWarnDiff', '5'],
    ['avalancheScannerWarnDiff', Number.NaN],
    ['avalancheScannerCriticalDiff', undefined],
    ['avalancheScannerCriticalDiff', 5],
    ['avalancheScannerCriticalDiff', 4],
    ['avalancheScannerCriticalDiff', 10.5],
    ['avalancheScannerCriticalDiff', '10'],
    ['avalancheScannerCriticalDiff', Number.NaN],
  ])('rejects invalid flat %s=%s', (key, value) => {
    expect(() =>
      parseAvalancheConfig(avalancheConfigData(), {
        ...avalancheHealthCheckData(),
        [key as string]: value,
      }),
    ).toThrow();
  });
  /**
   * @target parseAvalancheConfig rejects stale nested %s
   * @dependencies Address codec
   * @scenario An old nested threshold remains alongside valid flat settings
   * @expected Ambiguous deployment policy is refused instead of choosing silently
   */
  it.each(['warnDiff', 'criticalDiff'])('rejects stale nested %s', (key) => {
    const input = avalancheConfigData();
    expect(() =>
      parseAvalancheConfig(
        { ...input, health: { ...input.health, [key]: 100 } },
        avalancheHealthCheckData(),
      ),
    ).toThrow();
  });
});

describe('selectedAvalancheEndpoint', () => {
  /**
   * @target selectedAvalancheEndpoint resolves the selected source
   * @dependencies parseAvalancheConfig
   * @scenario An explicitly selected configured source is resolved
   * @expected That source is returned without fallback
   */
  it('resolves the selected source', () => {
    const config = parseAvalancheConfig(avalancheConfigData(), avalancheHealthCheckData())!;
    expect(selectedAvalancheEndpoint(config)).toEqual(config.endpoints[0]);
    expect(() => selectedAvalancheEndpoint({ ...config, selectedSourceId: 'missing' })).toThrow();
  });
});
