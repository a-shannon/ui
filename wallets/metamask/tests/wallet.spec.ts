import { describe, expect, it, vi } from 'vitest';

import type { Network } from '@rosen-ui/types';
import {
  CurrentChainError,
  UnsupportedChainError,
  UserDeniedTransactionSignatureError,
  WalletError,
} from '@rosen-ui/wallet-api';

import { MetaMaskWallet } from '../src/wallet';
import { submissionCalls } from './mocked/provider.mock';
import { avax, lock, metadata, sender, transfer } from './testData';
import { createWallet } from './testUtils';

describe('MetaMaskWallet', () => {
  describe('getEvmChainId', () => {
    /**
     * @target getEvmChainId should read a fresh chain rather than the cached chain
     * @dependencies synthetic SDK provider
     * @scenario cached Fuji ID disagrees with a fresh mainnet response
     * @expected the fresh chain is returned for the network facade to reject
     */
    it('should read a fresh chain rather than the cached chain', async () => {
      const { wallet, request } = await createWallet();
      request.mockResolvedValueOnce('0xa86a');
      expect(await wallet.getEvmChainId()).toEqual(43114n);
      expect(request).toHaveBeenCalledWith({ method: 'eth_chainId' });
    });

    /**
     * @target getEvmChainId should reject chain quantity %s
     * @dependencies synthetic SDK provider
     * @scenario each response is noncanonical, negative or not a string
     * @expected no chain ID is exposed and no submission occurs
     */
    it.each(['0x00', '-1', '43113', undefined])(
      'should reject chain quantity %s',
      async (value) => {
        const { wallet, request } = await createWallet();
        request.mockResolvedValueOnce(value);
        await expect(wallet.getEvmChainId()).rejects.toThrow('Invalid wallet chain ID');
        expect(submissionCalls(request)).toEqual([]);
      },
    );
  });

  describe('supportedChains', () => {
    /**
     * @target constructor should reject ambiguous Avalanche configurations
     * @dependencies real AvalancheNetwork
     * @scenario supply two Avalanche network entries
     * @expected configuration rejects before provider access
     */
    it('should reject ambiguous Avalanche configurations', async () => {
      const { network, config, request } = await createWallet();
      expect(() => new MetaMaskWallet({ ...config, networks: [network, network] })).toThrow(Error);
      expect(request).not.toHaveBeenCalled();
    });

    /**
     * @target constructor should pin the caller network list
     * @dependencies real configured network and mocked provider
     * @scenario clear the original caller network list after construction
     * @expected the configured wallet retains its selected Avalanche network
     */
    it('should pin the caller network list', async () => {
      const { wallet, config } = await createWallet();
      config.networks.length = 0;
      expect(wallet.currentChain).toEqual('avalanche');
      expect(wallet.currentNetwork?.name).toEqual('avalanche');
    });

    /**
     * @target supportedChains should advertise Avalanche only when configured
     * @dependencies real AvalancheNetwork and mocked SDK provider
     * @scenario compare a configured native wallet with an empty network list
     * @expected Avalanche appears only in the configured wallet; ETH/BSC remain
     */
    it('should advertise Avalanche only when configured', async () => {
      const { wallet } = await createWallet();
      expect(wallet.supportedChains).toEqual(['binance', 'ethereum', 'avalanche']);
      expect(new MetaMaskWallet({ networks: [], getTokenMap: vi.fn() }).supportedChains).toEqual([
        'binance',
        'ethereum',
      ]);
    });
  });

  describe('currentChain', () => {
    /**
     * @target currentChain should detect configured chain %s
     * @dependencies real AvalancheNetwork and mocked provider cached chain ID
     * @scenario instantiate each supported Avalanche deployment separately
     * @expected its cached ID resolves to Avalanche without a global default ID
     */
    it.each([43113, 43114] as const)('should detect configured chain %s', async (chainId) => {
      const { wallet } = await createWallet(chainId);
      expect(wallet.currentChain).toEqual('avalanche');
    });

    /**
     * @target currentChain should reject the other Avalanche deployment
     * @dependencies mocked provider cached chain ID
     * @scenario configure Fuji but expose a cached mainnet ID
     * @expected CurrentChainError prevents selecting a mismatched network
     */
    it('should reject the other Avalanche deployment', async () => {
      const { wallet, provider } = await createWallet();
      provider.chainId = '0xa86a';
      expect(() => wallet.currentChain).toThrow(CurrentChainError);
    });
  });

  describe('performSwitchChain', () => {
    /**
     * @target performSwitchChain should reject a wallet that did not switch deployment
     * @dependencies mocked switch response and fresh chain RPC
     * @scenario acknowledge switching to Fuji but report mainnet afterward
     * @expected CurrentChainError prevents treating the switch as successful
     */
    it('should reject a wallet that did not switch deployment', async () => {
      const { wallet, request } = await createWallet();
      const normal = request.getMockImplementation()!;
      request.mockImplementation(async (input) =>
        input.method === 'eth_chainId' ? '0xa86a' : await normal(input),
      );
      await expect(async () => await wallet.performSwitchChain('avalanche')).rejects.toThrow(
        CurrentChainError,
      );
      expect(submissionCalls(request)).toEqual([]);
    });

    /**
     * @target performSwitchChain should switch to configured chain %s
     * @dependencies mocked provider requests
     * @scenario switch to Avalanche for separate Fuji/mainnet configurations
     * @expected the configured hexadecimal ID is used
     */
    it.each([43113, 43114] as const)('should switch to configured chain %s', async (chainId) => {
      const { wallet, request } = await createWallet(chainId);
      await wallet.performSwitchChain('avalanche');
      expect(request).toHaveBeenCalledWith({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${chainId.toString(16)}` }],
      });
      expect(submissionCalls(request)).toEqual([]);
    });

    /**
     * @target performSwitchChain should reject an unconfigured Avalanche network
     * @dependencies none
     * @scenario request Avalanche from an empty configuration
     * @expected rejection occurs without invoking any provider
     */
    it('should reject an unconfigured Avalanche network', async () => {
      const wallet = new MetaMaskWallet({ networks: [], getTokenMap: vi.fn() });
      await expect(async () => await wallet.performSwitchChain('avalanche')).rejects.toThrow(
        UnsupportedChainError,
      );
    });
  });

  describe('performTransfer', () => {
    /**
     * @target performTransfer should reject actual map decimals inconsistent with native AVAX
     * @dependencies real TokenMap/Network/EVM and synthetic SDK
     * @scenario change only AVAX map decimals while keeping argument18 and amount10 above fees5
     * @expected no incorrect nine-decimal conversion reaches submission
     */
    it('should reject actual map decimals inconsistent with native AVAX', async () => {
      const { wallet, request, tokenMap } = await createWallet();
      const config = tokenMap.getRawConfig();
      config[0].avalanche.decimals = 9;
      await tokenMap.updateConfigByJson(config);
      await expect(wallet.performTransfer(transfer)).rejects.toThrow('native token mapping');
      expect(submissionCalls(request)).toEqual([]);
    });

    /**
     * @target performTransfer should reject token-map movement during gas estimation
     * @dependencies real TokenMap update API and synthetic estimator
     * @scenario change Ergo decimal scale while gas estimation is pending
     * @expected final policy check rejects with zero submission calls
     */
    it('should reject token-map movement during gas estimation', async () => {
      const { wallet, request, tokenMap } = await createWallet();
      const normal = request.getMockImplementation()!;
      request.mockImplementation(async (input) => {
        if (input.method === 'eth_estimateGas') {
          const config = tokenMap.getRawConfig();
          config[0].ergo.decimals = 9;
          await tokenMap.updateConfigByJson(config);
        }
        return normal(input);
      });
      await expect(wallet.performTransfer(transfer)).rejects.toThrow('token map changed');
      expect(submissionCalls(request)).toEqual([]);
    });

    /**
     * @target performTransfer should reject unfunded amount %s
     * @dependencies real native18 map and synthetic SDK
     * @scenario amount is below or equal to wrapped fees two plus three
     * @expected rejection before any provider request
     */
    it.each([4n, 5n])('should reject unfunded amount %s', async (amount) => {
      const { wallet, request } = await createWallet();
      await expect(wallet.performTransfer({ ...transfer, amount })).rejects.toThrow('exceed');
      expect(request).not.toHaveBeenCalled();
    });
    /**
     * @target performTransfer should reject delegation introduced during estimation
     * @dependencies synthetic EIP-1193 provider and real network/TokenMap
     * @scenario account becomes delegated during gas estimation without changing its address
     * @expected the final code check rejects with zero submission calls
     */
    it('should reject delegation introduced during estimation', async () => {
      const { wallet, request } = await createWallet();
      const normal = request.getMockImplementation()!;
      let delegated = false;
      request.mockImplementation(async (input) => {
        if (input.method === 'eth_estimateGas') delegated = true;
        if (input.method === 'eth_getCode' && delegated) return `0xef0100${'55'.repeat(20)}`;
        return normal(input);
      });
      await expect(wallet.performTransfer(transfer)).rejects.toThrow('standard account');
      expect(submissionCalls(request)).toEqual([]);
    });

    /**
     * @target performTransfer should preserve submission outcome %s
     * @dependencies synthetic send result; real preparation and estimator
     * @scenario send rejects with code4001, another RPC error or a transport error
     * @expected only code4001 is reported as user denial; one send and no automatic retry
     */
    it.each([{ code: 4001 }, { code: -32000 }, new Error('synthetic transport error')])(
      'should preserve submission outcome %s',
      async (failure) => {
        const { wallet, request } = await createWallet();
        const normal = request.getMockImplementation()!;
        request.mockImplementation(async (input) => {
          if (input.method === 'eth_sendTransaction') throw failure;
          return normal(input);
        });
        const error = await wallet.performTransfer(transfer).catch((value: unknown) => value);
        expect(error instanceof UserDeniedTransactionSignatureError).toEqual(
          'code' in failure && failure.code === 4001,
        );
        expect(error instanceof WalletError).toEqual(true);
        expect(submissionCalls(request)).toHaveLength(1);
      },
    );

    /**
     * @target performTransfer should preserve uncertainty after a malformed transaction ID
     * @dependencies synthetic successful send with an invalid transaction hash
     * @scenario provider returns a short hash after one send
     * @expected wallet activity must be checked; no user-denial claim or automatic retry
     */
    it('should preserve uncertainty after a malformed transaction ID', async () => {
      const { wallet, request } = await createWallet();
      const normal = request.getMockImplementation()!;
      request.mockImplementation(async (input) =>
        input.method === 'eth_sendTransaction' ? '0x123' : normal(input),
      );
      const error = await wallet.performTransfer(transfer).catch((value: unknown) => value);
      expect(error instanceof UserDeniedTransactionSignatureError).toEqual(false);
      expect(error instanceof WalletError).toEqual(true);
      expect((error as Error).message).toContain('Check wallet activity');
      expect(submissionCalls(request)).toHaveLength(1);
    });
    /**
     * @target performTransfer should reject sender code %s
     * @dependencies mocked code RPC and synthetic SDK provider
     * @scenario independently return delegated-account code, contract code or missing data
     * @expected no native transaction reaches the submission gate
     */
    it.each([`0xef0100${'11'.repeat(20)}`, '0x6000', undefined])(
      'should reject sender code %s',
      async (code) => {
        const { wallet, request } = await createWallet();
        const normal = request.getMockImplementation()!;
        request.mockImplementation(async (input) =>
          input.method === 'eth_getCode' ? code : await normal(input),
        );
        await expect(async () => await wallet.performTransfer(transfer)).rejects.toThrow(Error);
        expect(submissionCalls(request)).toEqual([]);
      },
    );

    /**
     * @target performTransfer should retain the pinned transfer while awaiting metadata
     * @dependencies real network metadata generator and mocked SDK provider
     * @scenario mutate the caller amount and lock address during asynchronous metadata generation
     * @expected submitted fields retain the original amount and configured custody
     */
    it('should retain the pinned transfer while awaiting metadata', async () => {
      const { wallet, network, request } = await createWallet();
      const input = { ...transfer, token: { ...avax } };
      const generate = network.generateLockData;
      vi.spyOn(network, 'generateLockData').mockImplementation(async (...args) => {
        input.amount = 2n;
        input.lockAddress = sender;
        input.token.decimals = 9;
        return await generate(...args);
      });
      await wallet.performTransfer(input);
      expect(submissionCalls(request)).toEqual([
        [
          {
            method: 'eth_sendTransaction',
            params: [
              {
                from: sender,
                to: lock,
                data: `0x${metadata}`,
                value: '0x174876e800',
                chainId: '0xa869',
                gas: '0x7530',
              },
            ],
          },
        ],
      ]);
    });

    /**
     * @target performTransfer should reject a replaced SDK provider after estimation
     * @dependencies mocked SDK provider getter and gas estimator
     * @scenario replace the provider object while the gas estimate is pending
     * @expected the original request stream never receives a send
     */
    it('should reject a replaced SDK provider after estimation', async () => {
      const { wallet, provider, request, sdk } = await createWallet();
      const normal = request.getMockImplementation()!;
      request.mockImplementation(async (input) => {
        if (input.method === 'eth_estimateGas') sdk.getProvider = () => ({ ...provider });
        return await normal(input);
      });
      await expect(async () => await wallet.performTransfer(transfer)).rejects.toThrow(Error);
      expect(submissionCalls(request)).toEqual([]);
    });

    /**
     * @target performTransfer should submit one fully qualified native AVAX lock
     * @dependencies real TokenMap, AvalancheNetwork and EVM generators; mocked SDK request
     * @scenario prepare ten wrapped AVAX units with fees totaling five and estimate gas synthetically
     * @expected exactly one send uses selected chain, sender, custody, metadata, amount and gas
     */
    it('should submit one fully qualified native AVAX lock', async () => {
      const { wallet, request } = await createWallet();
      expect(await wallet.performTransfer(transfer)).toEqual(`0x${'44'.repeat(32)}`);
      const transaction = {
        from: sender,
        to: lock,
        data: `0x${metadata}`,
        value: '0x174876e800',
        chainId: '0xa869',
      };
      expect(request).toHaveBeenCalledWith({ method: 'eth_estimateGas', params: [transaction] });
      expect(submissionCalls(request)).toEqual([
        [{ method: 'eth_sendTransaction', params: [{ ...transaction, gas: '0x7530' }] }],
      ]);
      const methods = request.mock.calls.map(([input]) => input.method);
      expect(methods.slice(-3)).toEqual(['eth_accounts', 'eth_chainId', 'eth_sendTransaction']);
    });

    /**
     * @target performTransfer should reject a stale provider chain before estimating gas
     * @dependencies mocked fresh chain RPC; cached provider identity remains Fuji
     * @scenario return mainnet only from fresh eth_chainId calls
     * @expected no estimate or send is issued
     */
    it('should reject a stale provider chain before estimating gas', async () => {
      const { wallet, request } = await createWallet();
      const normal = request.getMockImplementation()!;
      request.mockImplementation(async (input) =>
        input.method === 'eth_chainId' ? '0xa86a' : await normal(input),
      );
      await expect(async () => await wallet.performTransfer(transfer)).rejects.toThrow(Error);
      expect(request.mock.calls.some(([input]) => input.method === 'eth_estimateGas')).toEqual(
        false,
      );
      expect(submissionCalls(request)).toEqual([]);
    });

    /**
     * @target performTransfer should reject chain movement during gas estimation
     * @dependencies mocked chain RPC and gas estimator
     * @scenario expose Fuji before estimation and mainnet after estimation
     * @expected no send follows the changed chain observation
     */
    it('should reject chain movement during gas estimation', async () => {
      const { wallet, request } = await createWallet();
      const normal = request.getMockImplementation()!;
      let estimated = false;
      request.mockImplementation(async (input) => {
        if (input.method === 'eth_estimateGas') estimated = true;
        if (input.method === 'eth_chainId' && estimated) return '0xa86a';
        return await normal(input);
      });
      await expect(async () => await wallet.performTransfer(transfer)).rejects.toThrow(Error);
      expect(submissionCalls(request)).toEqual([]);
    });

    /**
     * @target performTransfer should reject account movement during gas estimation
     * @dependencies mocked accounts RPC and gas estimator
     * @scenario expose the sender before estimation and a different account afterward
     * @expected no send follows the changed account observation
     */
    it('should reject account movement during gas estimation', async () => {
      const { wallet, request } = await createWallet();
      const normal = request.getMockImplementation()!;
      let estimated = false;
      request.mockImplementation(async (input) => {
        if (input.method === 'eth_estimateGas') estimated = true;
        if (input.method === 'eth_accounts' && estimated) return [lock];
        return await normal(input);
      });
      await expect(async () => await wallet.performTransfer(transfer)).rejects.toThrow(Error);
      expect(submissionCalls(request)).toEqual([]);
    });

    /**
     * @target performTransfer should reject altered %s
     * @dependencies mocked network generator with real wallet preparation/conversion
     * @scenario independently alter recipient, sender, data, value or chain ID
     * @expected no synthetic send occurs for any altered field
     */
    it.each([
      ['recipient', { to: sender }],
      ['sender', { from: lock }],
      ['metadata', { data: '0x00' }],
      ['amount', { value: '0x1' }],
      ['chain', { chainId: '0xa86a' }],
    ])('should reject altered %s', async (_name, changed) => {
      const { wallet, network, request } = await createWallet();
      vi.spyOn(network, 'generateTxParameters').mockResolvedValue({
        to: lock,
        from: sender,
        data: `0x${metadata}`,
        value: '0x174876e800',
        chainId: '0xa869',
        ...changed,
      });
      await expect(async () => await wallet.performTransfer(transfer)).rejects.toThrow(Error);
      expect(submissionCalls(request)).toEqual([]);
    });

    /**
     * @target performTransfer should reject gas estimate %s
     * @dependencies mocked native transaction estimator
     * @scenario return bare-transfer gas, zero, leading zeros or an oversized quantity
     * @expected full-calldata validation rejects before send
     */
    it.each(['0x5208', '0x0', '0x07530', '0x10000000000000000'])(
      'should reject gas estimate %s',
      async (gas) => {
        const { wallet, request } = await createWallet();
        const normal = request.getMockImplementation()!;
        request.mockImplementation(async (input) =>
          input.method === 'eth_estimateGas' ? gas : await normal(input),
        );
        await expect(async () => await wallet.performTransfer(transfer)).rejects.toThrow(Error);
        expect(submissionCalls(request)).toEqual([]);
      },
    );

    /**
     * @target performTransfer should reject invalid %s
     * @dependencies synthetic provider
     * @scenario independently alter source chain, asset type, decimals, custody or amount
     * @expected every fixture rejects before send
     */
    it.each([
      ['source chain', { fromChain: 'ethereum' as Network }],
      ['asset type', { token: { ...avax, type: 'ERC-20' } }],
      ['decimals', { token: { ...avax, decimals: 9 } }],
      ['custody', { lockAddress: sender }],
      ['amount', { amount: 0n }],
    ])('should reject invalid %s', async (_name, changed) => {
      const { wallet, request } = await createWallet();
      await expect(
        async () => await wallet.performTransfer({ ...transfer, ...changed }),
      ).rejects.toThrow(Error);
      expect(submissionCalls(request)).toEqual([]);
    });
  });

  describe('fetchBalance', () => {
    /**
     * @target fetchBalance should reject chain movement during the balance query
     * @dependencies mocked native balance and fresh chain RPC
     * @scenario expose Fuji before the balance response and mainnet afterward
     * @expected a balance from a changing wallet context is not returned
     */
    it('should reject chain movement during the balance query', async () => {
      const { wallet, request } = await createWallet();
      const normal = request.getMockImplementation()!;
      let queried = false;
      request.mockImplementation(async (input) => {
        if (input.method === 'eth_getBalance') queried = true;
        if (input.method === 'eth_chainId' && queried) return '0xa86a';
        return await normal(input);
      });
      await expect(async () => await wallet.fetchBalance(avax)).rejects.toThrow(Error);
      expect(submissionCalls(request)).toEqual([]);
    });

    /**
     * @target fetchBalance should reject a malformed native balance
     * @dependencies mocked native balance RPC
     * @scenario return a noncanonical quantity instead of an AVAX balance
     * @expected the invalid quantity is not returned
     */
    it('should reject a malformed native balance', async () => {
      const { wallet, request } = await createWallet();
      const normal = request.getMockImplementation()!;
      request.mockImplementation(async (input) =>
        input.method === 'eth_getBalance' ? '0x0001' : await normal(input),
      );
      await expect(async () => await wallet.fetchBalance(avax)).rejects.toThrow(Error);
      expect(submissionCalls(request)).toEqual([]);
    });

    /**
     * @target fetchBalance should fetch native AVAX for the selected sender
     * @dependencies mocked accounts, permissions and native balance RPC
     * @scenario read native AVAX with the configured C-Chain selected
     * @expected the native balance request includes the actual sender address
     */
    it('should fetch native AVAX for the selected sender', async () => {
      const { wallet, request } = await createWallet();
      expect(await wallet.fetchBalance(avax)).toEqual('0x2540be400');
      expect(request).toHaveBeenCalledWith({
        method: 'eth_getBalance',
        params: [sender, 'latest'],
      });
      expect(submissionCalls(request)).toEqual([]);
    });

    /**
     * @target fetchBalance should reject non-native Avalanche assets
     * @dependencies synthetic provider
     * @scenario request an ERC-20 balance on the selected C-Chain
     * @expected rejection without contract RPC or send
     */
    it('should reject non-native Avalanche assets', async () => {
      const { wallet, request } = await createWallet();
      await expect(
        async () => await wallet.fetchBalance({ ...avax, type: 'ERC-20' }),
      ).rejects.toThrow(Error);
      expect(request).not.toHaveBeenCalled();
    });
  });
});
