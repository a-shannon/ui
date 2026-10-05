import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type RosenChainToken, TokenMap } from '@rosen-bridge/tokens';
import { generateTxParameters } from '@rosen-network/evm';
import type { Network as NetworkName } from '@rosen-ui/types';

import { AvalancheNetwork, type AvalancheNetworkConfig } from '../src/client';
import type { AvalancheChainId } from '../src/constants';
import { avax, lock, metadata, sender } from './testData';
import { createMap } from './testUtils';

describe('AvalancheNetwork', () => {
  let config: AvalancheNetworkConfig;
  let network: AvalancheNetwork;

  beforeEach(async () => {
    const tokenMap = await createMap();
    config = {
      chainId: 43113,
      lockAddress: lock,
      nextHeightInterval: 50,
      getProviderChainId: vi.fn().mockResolvedValue(43113n),
      getWalletChainId: vi.fn().mockResolvedValue(43113),
      getTokenMap: async () => tokenMap,
      calculateFee: vi.fn(),
      generateLockData: vi.fn().mockResolvedValue(metadata),
      generateTxParameters: vi.fn().mockResolvedValue({
        to: lock,
        from: sender,
        value: '0x174876e800',
        data: `0x${metadata}`,
      }),
      getMaxTransfer: vi.fn().mockResolvedValue(100n),
      getMinTransfer: vi.fn().mockResolvedValue(10n),
      validateAddress: vi.fn().mockResolvedValue(true),
    };
    network = new AvalancheNetwork(config);
  });

  describe('constructor', () => {
    /**
     * @target constructor should expose the native C-Chain identity
     * @dependencies shared network metadata and icon
     * @scenario construct with an explicit Fuji configuration
     * @expected Avalanche label, key, custody address and chain ID are retained
     */
    it('should expose the native C-Chain identity', () => {
      expect(network.name).toEqual('avalanche');
      expect(network.label).toEqual('Avalanche C-Chain');
      expect(network.chainId).toEqual(43113);
      expect(network.lockAddress).toEqual(lock);
    });

    /**
     * @target constructor should reject an unsupported chain
     * @dependencies shared EVM address validator
     * @scenario replace only the deployment ID with Ethereum
     * @expected construction throws before any observer is called
     */
    it('should reject an unsupported chain', () => {
      expect(() => new AvalancheNetwork({ ...config, chainId: 1 as AvalancheChainId })).toThrow(
        Error,
      );
      expect(config.getProviderChainId).not.toHaveBeenCalled();
    });

    /**
     * @target constructor should reject invalid custody %s
     * @dependencies shared EVM address validator
     * @scenario replace the custody address with a short or all-zero address
     * @expected construction throws before any provider operation
     */
    it.each(['0x00', `0x${'00'.repeat(20)}`])('should reject invalid custody %s', (lockAddress) => {
      expect(() => new AvalancheNetwork({ ...config, lockAddress })).toThrow(Error);
      expect(config.getProviderChainId).not.toHaveBeenCalled();
    });

    /**
     * @target constructor should pin its caller configuration
     * @dependencies none
     * @scenario mutate the original chain and generator after construction
     * @expected the network retains the selected deployment and generator
     */
    it('should pin its caller configuration', async () => {
      const original = config.generateTxParameters;
      config.chainId = 43114;
      config.generateTxParameters = vi.fn().mockRejectedValue(new Error('replacement'));
      await network.generateTxParameters('avax', lock, sender, 10n, metadata, avax, 'avalanche');
      expect(original).toHaveBeenCalled();
      expect(config.generateTxParameters).not.toHaveBeenCalled();
    });
  });

  describe('generateTxParameters', () => {
    /**
     * @target generateTxParameters should compose real native AVAX amount conversion
     * @dependencies actual EVM generator and TokenMap; mocked chain observers
     * @scenario register 18-decimal AVAX with an 8-decimal synthetic Ergo representation
     * @expected ten wrapped units prepare exactly one hundred billion native units on Fuji
     */
    it('should compose real native AVAX amount conversion', async () => {
      const tokenMap = new TokenMap();
      await tokenMap.updateConfigByJson([
        {
          avalanche: avax,
          ergo: {
            tokenId: '55'.repeat(32),
            name: 'AVAX',
            decimals: 8,
            type: 'token',
            residency: 'wrapped',
            extra: {},
          },
        },
      ]);
      network = new AvalancheNetwork({
        ...config,
        generateTxParameters: generateTxParameters(async () => tokenMap),
      });
      expect(
        await network.generateTxParameters('avax', lock, sender, 10n, metadata, avax, 'avalanche'),
      ).toEqual({
        to: lock,
        from: sender,
        data: `0x${metadata}`,
        value: '0x174876e800',
        chainId: '0xa869',
      });
    });

    /**
     * @target generateTxParameters should qualify and bind a native Fuji lock
     * @dependencies provider/wallet chain observers and shared EVM generator (mocked)
     * @scenario prepare valid AVAX with matching chain observations
     * @expected exact native parameters include Fuji chain ID and two observations each
     */
    it('should qualify and bind a native Fuji lock', async () => {
      expect(
        await network.generateTxParameters('avax', lock, sender, 10n, metadata, avax, 'avalanche'),
      ).toEqual({
        to: lock,
        from: sender,
        value: '0x174876e800',
        data: `0x${metadata}`,
        chainId: '0xa869',
      });
      expect(config.generateTxParameters).toHaveBeenCalledWith(
        'avax',
        lock,
        sender,
        10n,
        metadata,
        avax,
        'avalanche',
      );
      expect(config.getProviderChainId).toHaveBeenCalledTimes(2);
      expect(config.getWalletChainId).toHaveBeenCalledTimes(2);
    });

    /**
     * @target generateTxParameters should bind an explicitly selected mainnet identity
     * @dependencies chain observers and shared EVM generator (mocked)
     * @scenario select mainnet with synthetic observers and no network requests
     * @expected returned parameters contain C-Chain mainnet chain ID
     */
    it('should bind an explicitly selected mainnet identity', async () => {
      config.chainId = 43114;
      config.getProviderChainId = vi.fn().mockResolvedValue(43114n);
      config.getWalletChainId = vi.fn().mockResolvedValue(43114);
      network = new AvalancheNetwork(config);
      const result = await network.generateTxParameters(
        'avax',
        lock,
        sender,
        10n,
        metadata,
        avax,
        'avalanche',
      );
      expect(result.chainId).toEqual('0xa86a');
    });

    /**
     * @target generateTxParameters should reject a wrong provider before generation
     * @dependencies mocked provider identity observer
     * @scenario change only the provider identity to Ethereum
     * @expected rejection and no generator call
     */
    it('should reject a wrong provider before generation', async () => {
      vi.mocked(config.getProviderChainId).mockResolvedValue(1n);
      await expect(
        async () =>
          await network.generateTxParameters(
            'avax',
            lock,
            sender,
            10n,
            metadata,
            avax,
            'avalanche',
          ),
      ).rejects.toThrow(Error);
      expect(config.generateTxParameters).not.toHaveBeenCalled();
    });

    /**
     * @target generateTxParameters should reject a wrong wallet before generation
     * @dependencies mocked wallet identity observer
     * @scenario change only the wallet identity to mainnet
     * @expected rejection and no generator call
     */
    it('should reject a wrong wallet before generation', async () => {
      vi.mocked(config.getWalletChainId).mockResolvedValue(43114);
      await expect(
        async () =>
          await network.generateTxParameters(
            'avax',
            lock,
            sender,
            10n,
            metadata,
            avax,
            'avalanche',
          ),
      ).rejects.toThrow(Error);
      expect(config.generateTxParameters).not.toHaveBeenCalled();
    });

    /**
     * @target generateTxParameters should reject provider movement during generation
     * @dependencies provider identity observer and EVM generator (mocked)
     * @scenario provider returns Fuji before and mainnet after generation
     * @expected no transaction parameters are exposed
     */
    it('should reject provider movement during generation', async () => {
      vi.mocked(config.getProviderChainId)
        .mockResolvedValueOnce(43113n)
        .mockResolvedValueOnce(43114n);
      await expect(
        async () =>
          await network.generateTxParameters(
            'avax',
            lock,
            sender,
            10n,
            metadata,
            avax,
            'avalanche',
          ),
      ).rejects.toThrow(Error);
      expect(config.generateTxParameters).toHaveBeenCalledTimes(1);
    });

    /**
     * @target generateTxParameters should reject wallet movement during generation
     * @dependencies wallet identity observer and EVM generator (mocked)
     * @scenario wallet returns Fuji before and mainnet after generation
     * @expected no transaction parameters are exposed
     */
    it('should reject wallet movement during generation', async () => {
      vi.mocked(config.getWalletChainId).mockResolvedValueOnce(43113).mockResolvedValueOnce(43114);
      await expect(
        async () =>
          await network.generateTxParameters(
            'avax',
            lock,
            sender,
            10n,
            metadata,
            avax,
            'avalanche',
          ),
      ).rejects.toThrow(Error);
      expect(config.generateTxParameters).toHaveBeenCalledTimes(1);
    });

    /**
     * @target generateTxParameters should reject invalid %s
     * @dependencies shared EVM address validator; transaction generator (mocked)
     * @scenario replace exactly one valid input per isolated fixture
     * @expected each fixture rejects before the generator or identity callbacks
     */
    it.each([
      ['token ID', { tokenId: 'other' }],
      ['source chain', { fromChain: 'ethereum' }],
      ['token definition ID', { token: { ...avax, tokenId: 'other' } }],
      ['token type', { token: { ...avax, type: 'ERC-20' } }],
      ['decimals', { token: { ...avax, decimals: 9 } }],
      ['zero amount', { amount: 0n }],
      ['negative amount', { amount: -1n }],
      ['sender address', { fromAddress: '0x00' }],
      ['custody address', { lockAddress: sender }],
      ['odd metadata', { data: metadata.slice(1) }],
      ['metadata address length', { data: `${metadata.slice(0, 34)}13${metadata.slice(36)}` }],
      ['uppercase metadata', { data: `AB${metadata.slice(2)}` }],
    ])('should reject invalid %s', async (_name, changed) => {
      const input = {
        tokenId: 'avax',
        lockAddress: lock,
        fromAddress: sender,
        amount: 10n,
        data: metadata,
        token: avax,
        fromChain: 'avalanche',
        ...changed,
      };
      await expect(
        async () =>
          await network.generateTxParameters(
            input.tokenId,
            input.lockAddress,
            input.fromAddress,
            input.amount,
            input.data,
            input.token as RosenChainToken,
            input.fromChain as NetworkName,
          ),
      ).rejects.toThrow(Error);
      expect(config.generateTxParameters).not.toHaveBeenCalled();
      expect(config.getProviderChainId).not.toHaveBeenCalled();
    });
  });

  describe('returned transaction parameters', () => {
    /**
     * @target generateTxParameters should reject altered %s
     * @dependencies configured EVM generator and chain observers (mocked)
     * @scenario independently replace custody, sender, metadata or native value
     * @expected parameters are not exposed after any single-field alteration
     */
    it.each([
      ['custody', { to: sender }],
      ['sender', { from: lock }],
      ['metadata', { data: '0x00' }],
      ['zero value', { value: '0x0' }],
      ['noncanonical value', { value: '0x01' }],
      ['oversized value', { value: `0x1${'0'.repeat(64)}` }],
    ])('should reject altered %s', async (_name, changed) => {
      vi.mocked(config.generateTxParameters).mockResolvedValue({
        to: lock,
        from: sender,
        data: `0x${metadata}`,
        value: '0x174876e800',
        ...changed,
      });
      await expect(
        async () =>
          await network.generateTxParameters(
            'avax',
            lock,
            sender,
            10n,
            metadata,
            avax,
            'avalanche',
          ),
      ).rejects.toThrow(Error);
    });
  });

  describe('toSafeAddress', () => {
    /**
     * @target toSafeAddress should preserve a validated address identity
     * @dependencies shared EVM validator
     * @scenario normalize a valid address and reject a short address
     * @expected valid address remains unchanged; malformed input throws
     */
    it('should preserve a validated address identity', () => {
      expect(network.toSafeAddress(sender)).toEqual(sender);
      expect(() => network.toSafeAddress('0x00')).toThrow(Error);
    });
  });

  describe('getMaxTransfer', () => {
    /**
     * @target getMaxTransfer should reject non-native assets
     * @dependencies configured maximum-transfer action (mocked)
     * @scenario submit a non-native transfer request
     * @expected rejection occurs without calling the action
     */
    it('should reject non-native assets', () => {
      expect(() =>
        network.getMaxTransfer({
          balance: 100n,
          isNative: false,
          eventData: { toChain: 'ergo', fromAddress: sender, toAddress: 'synthetic' },
        }),
      ).toThrow(Error);
      expect(config.getMaxTransfer).not.toHaveBeenCalled();
    });
  });

  describe('getMinTransfer', () => {
    /**
     * @target getMinTransfer should reject non-native assets
     * @dependencies configured minimum-transfer action (mocked)
     * @scenario request a minimum for a token with the wrong type
     * @expected rejection occurs without calling the action
     */
    it('should reject non-native assets', () => {
      expect(() => network.getMinTransfer({ ...avax, type: 'ERC-20' }, 'ergo', 'nft')).toThrow(
        Error,
      );
      expect(config.getMinTransfer).not.toHaveBeenCalled();
    });
  });

  describe('validateAddress', () => {
    /**
     * @target validateAddress should bind the shared codec to Avalanche
     * @dependencies address validation action (mocked)
     * @scenario validate a synthetic EVM address
     * @expected Avalanche is passed as the codec chain
     */
    it('should bind the shared codec to Avalanche', async () => {
      expect(await network.validateAddress(sender)).toEqual(true);
      expect(config.validateAddress).toHaveBeenCalledWith('avalanche', sender);
    });
  });
});
