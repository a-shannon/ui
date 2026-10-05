import { Interface } from 'ethers';
import { describe, expect, it, vi } from 'vitest';

import { TokenMap } from '@rosen-bridge/tokens';
import { UserDeniedTransactionSignatureError, WalletError } from '@rosen-ui/wallet-api';

import {
  exampleCalldata,
  exampleSender,
  joe,
} from '../../../networks/avalanche/tests/erc20TestData';
import { generatedOverlay, payloadFaults, tokenTransfer } from './erc20TestData';
import { createTokenWallet } from './erc20TestUtils';
import { submissionCalls } from './mocked/provider.mock';

describe('MetaMaskWallet', () => {
  describe('fetchBalance', () => {
    /**
     * @target fetchBalance should read the mapped JOE balance through the SDK provider
     * @dependencies real generated overlay, TokenMap and AvalancheNetwork; synthetic SDK
     * @scenario window.ethereum is unavailable but the selected SDK returns an ABI uint256
     * @expected balanceOf targets JOE and the captured account, returning a raw balance without a send
     */
    it('should read the mapped JOE balance through the SDK provider', async () => {
      const { wallet, request } = await createTokenWallet();
      expect(await wallet.fetchBalance(joe)).toEqual('0x174876e800');
      expect(request).toHaveBeenCalledWith({
        method: 'eth_call',
        params: [
          {
            to: joe.tokenId,
            data: new Interface(['function balanceOf(address)']).encodeFunctionData('balanceOf', [
              exampleSender,
            ]),
          },
          'latest',
        ],
      });
      expect(submissionCalls(request)).toEqual([]);
    });

    /**
     * @target fetchBalance should reject malformed balance result %s
     * @dependencies synthetic balanceOf response
     * @scenario independently return empty, truncated, trailing or nonhex ABI data
     * @expected no malformed balance is exposed
     */
    it.each(['0x', '0x1', `0x${'00'.repeat(33)}`, `0x${'gg'.repeat(32)}`, undefined])(
      'should reject malformed balance result %s',
      async (value) => {
        const { wallet, request } = await createTokenWallet();
        const normal = request.getMockImplementation()!;
        request.mockImplementation(async (input) =>
          input.method === 'eth_call' ? value : normal(input),
        );
        await expect(wallet.fetchBalance(joe)).rejects.toThrow('token balance');
        expect(submissionCalls(request)).toEqual([]);
      },
    );

    /**
     * @target fetchBalance should reject identity movement %s during the token RPC
     * @dependencies real map and synthetic SDK provider
     * @scenario mutate one of account, chain, provider or map while balanceOf is pending
     * @expected the stale raw balance is not returned
     */
    it.each(['account', 'chain', 'provider', 'map', 'map reader'] as const)(
      'should reject identity movement %s during the token RPC',
      async (fault) => {
        const context = await createTokenWallet();
        const { wallet, request, provider, sdk, tokenMap, mapReader } = context;
        const normal = request.getMockImplementation()!;
        let queried = false;
        request.mockImplementation(async (input) => {
          if (input.method === 'eth_call') {
            queried = true;
            if (fault === 'provider') sdk.getProvider = () => ({ ...provider });
            if (fault === 'map') {
              const raw = tokenMap.getRawConfig();
              raw[1].ergo.decimals = 8;
              await tokenMap.updateConfigByJson(raw);
            }
            if (fault === 'map reader') mapReader.value = new TokenMap();
          }
          if (queried && input.method === 'eth_accounts' && fault === 'account')
            return [tokenTransfer.lockAddress];
          if (queried && input.method === 'eth_chainId' && fault === 'chain') return '0xa869';
          return normal(input);
        });
        await expect(wallet.fetchBalance(joe)).rejects.toThrow();
        expect(submissionCalls(request)).toEqual([]);
      },
    );
  });

  describe('performTransfer', () => {
    /**
     * @target performTransfer should submit the original generic producer example
     * @dependencies real generic EVM producer and frozen eight-decimal counterpart fixture
     * @scenario prepare the first mainnet JOE example with synthetic account, custody and RPCs
     * @expected one direct transfer exactly preserves the frozen calldata, with AVAX gas and no native value
     */
    it('should submit the original generic producer example', async () => {
      const { wallet, request } = await createTokenWallet(8);
      expect(await wallet.performTransfer(tokenTransfer)).toEqual(`0x${'44'.repeat(32)}`);
      expect(submissionCalls(request)).toEqual([
        [
          {
            method: 'eth_sendTransaction',
            params: [
              {
                from: exampleSender,
                to: joe.tokenId,
                data: exampleCalldata,
                chainId: '0xa86a',
                gas: '0x7530',
                gasPrice: '0x2',
              },
            ],
          },
        ],
      ]);
      expect(request.mock.calls.map(([input]) => input.method).slice(-3)).toEqual([
        'eth_accounts',
        'eth_chainId',
        'eth_sendTransaction',
      ]);
    });

    /**
     * @target performTransfer should consume the actual contract-generator token definitions
     * @dependencies real UI TokenMap 6.0.2 and generated ERC-20/EIP-004 overlay fixture
     * @scenario native JOE18 maps to the generated synthetic Ergo9 counterpart
     * @expected raw amount is ten billion and custody/metadata stay intact without approval or AVAX value
     */
    it('should consume the actual contract-generator token definitions', async () => {
      const { wallet, request, tokenMap } = await createTokenWallet();
      expect(tokenMap.getRawConfig()).toEqual(generatedOverlay);
      await wallet.performTransfer(tokenTransfer);
      const transaction = submissionCalls(request)[0][0].params[0];
      const abi = new Interface(['function transfer(address,uint256)']);
      expect(abi.decodeFunctionData('transfer', transaction.data.slice(0, 138)).toArray()).toEqual([
        tokenTransfer.lockAddress,
        10000000000n,
      ]);
      expect(transaction.value).toBeUndefined();
      expect(transaction.data.slice(0, 10)).toEqual('0xa9059cbb');
      expect(submissionCalls(request)).toHaveLength(1);
    });

    /**
     * @target performTransfer should accept an authoritative wrapped ERC20 mapping
     * @dependencies real TokenMap and generic EVM producer
     * @scenario map the standard ERC20 as wrapped and its Ergo counterpart as native
     * @expected the identified mapped family transfers normally
     */
    it('should accept an authoritative wrapped ERC20 mapping', async () => {
      const { wallet, request, tokenMap } = await createTokenWallet();
      const raw = tokenMap.getRawConfig();
      raw[1].avalanche.residency = 'wrapped';
      raw[1].ergo.residency = 'native';
      await tokenMap.updateConfigByJson(raw);
      await wallet.performTransfer({ ...tokenTransfer, token: { ...joe, residency: 'wrapped' } });
      expect(submissionCalls(request)).toHaveLength(1);
    });

    /**
     * @target performTransfer should reject unfunded or malformed RPC field %s
     * @dependencies real conversion and synthetic balance/price/estimator responses
     * @scenario isolate insufficient tokens, insufficient AVAX, malformed quantities, price overflow or intrinsic gas
     * @expected no token send follows any unqualified funding input
     */
    it.each([
      ['token shortage', 'eth_call', `0x${9999999999n.toString(16).padStart(64, '0')}`],
      ['gas shortage', 'eth_getBalance', '0xea5f'],
      ['gas price zero', 'eth_gasPrice', '0x0'],
      ['gas price leading zero', 'eth_gasPrice', '0x02'],
      ['gas price overflow', 'eth_gasPrice', `0x1${'0'.repeat(64)}`],
      ['gas reserve overflow', 'eth_gasPrice', `0x${'f'.repeat(64)}`],
      ['AVAX leading zero', 'eth_getBalance', '0x00'],
      ['AVAX overflow', 'eth_getBalance', `0x1${'0'.repeat(64)}`],
      ['bare-transfer gas', 'eth_estimateGas', '0x5208'],
      ['calldata-short gas', 'eth_estimateGas', '0x5548'],
      ['zero gas', 'eth_estimateGas', '0x0'],
      ['overflow gas', 'eth_estimateGas', '0x10000000000000000'],
    ])('should reject unfunded or malformed RPC field %s', async (_name, method, value) => {
      const { wallet, request } = await createTokenWallet();
      const normal = request.getMockImplementation()!;
      request.mockImplementation(async (input) =>
        input.method === method ? value : normal(input),
      );
      await expect(wallet.performTransfer(tokenTransfer)).rejects.toThrow();
      expect(submissionCalls(request)).toEqual([]);
    });

    /**
     * @target performTransfer should accept exact independent token and AVAX funding
     * @dependencies real conversion and synthetic RPC balances
     * @scenario token balance equals the raw amount and AVAX balance equals gas times gasPrice
     * @expected both equalities permit the single direct transfer
     */
    it('should accept exact independent token and AVAX funding', async () => {
      const { wallet, request } = await createTokenWallet();
      const normal = request.getMockImplementation()!;
      request.mockImplementation(async (input) => {
        if (input.method === 'eth_call') return `0x${10000000000n.toString(16).padStart(64, '0')}`;
        if (input.method === 'eth_getBalance') return '0xea60';
        return normal(input);
      });
      await wallet.performTransfer(tokenTransfer);
      expect(submissionCalls(request)).toHaveLength(1);
    });

    /**
     * @target performTransfer should reject late identity movement %s
     * @dependencies real facade requalification after estimator/funding and synthetic SDK
     * @scenario change exactly one provider chain, wallet chain, account, SDK provider, map or account code after estimation
     * @expected final qualification prevents every altered context from reaching send
     */
    it.each([
      'provider chain',
      'wallet chain',
      'account',
      'SDK provider',
      'map',
      'map reader',
      'delegation',
    ] as const)('should reject late identity movement %s', async (fault) => {
      const { wallet, request, provider, sdk, chain, tokenMap, mapReader } =
        await createTokenWallet();
      const normal = request.getMockImplementation()!;
      let estimated = false;
      request.mockImplementation(async (input) => {
        if (input.method === 'eth_estimateGas') {
          estimated = true;
          if (fault === 'provider chain') chain.provider = 43113n;
          if (fault === 'SDK provider') sdk.getProvider = () => ({ ...provider });
          if (fault === 'map') {
            const raw = tokenMap.getRawConfig();
            raw[1].ergo.decimals = 8;
            await tokenMap.updateConfigByJson(raw);
          }
          if (fault === 'map reader') {
            const replacement = new TokenMap();
            await replacement.updateConfigByJson(generatedOverlay);
            mapReader.value = replacement;
          }
        }
        if (estimated && fault === 'wallet chain' && input.method === 'eth_chainId')
          return '0xa869';
        if (estimated && fault === 'account' && input.method === 'eth_accounts')
          return [tokenTransfer.lockAddress];
        if (estimated && fault === 'delegation' && input.method === 'eth_getCode')
          return `0xef0100${'11'.repeat(20)}`;
        return normal(input);
      });
      await expect(wallet.performTransfer(tokenTransfer)).rejects.toThrow();
      expect(submissionCalls(request)).toEqual([]);
    });

    /**
     * @target performTransfer should reject payload fault %s at construction %s
     * @dependencies real wrapper result with one postconstruction field mutation
     * @scenario alter one exact transaction field at either initial or final facade qualification
     * @expected each single fault prevents a token send
     */
    it.each(
      payloadFaults.flatMap(
        (fault) =>
          [
            [fault, 1],
            [fault, 2],
          ] as const,
      ),
    )('should reject payload fault %s at construction %s', async (fault, atCall) => {
      const { wallet, request, network } = await createTokenWallet(8);
      const generate = network.generateTxParameters;
      let calls = 0;
      vi.spyOn(network, 'generateTxParameters').mockImplementation(async (...args) => {
        const transaction = await generate(...args);
        return ++calls === atCall ? { ...transaction, ...fault } : transaction;
      });
      await expect(wallet.performTransfer(tokenTransfer)).rejects.toThrow();
      expect(submissionCalls(request)).toEqual([]);
    });

    /**
     * @target performTransfer should reject provider-chain movement during final account-code RPC
     * @dependencies real final facade qualification and synthetic standard-account response
     * @scenario return the unchanged EOA code while changing the network provider chain on its second lookup
     * @expected the final network observation rejects before the wallet send
     */
    it('should reject provider-chain movement during final account-code RPC', async () => {
      const { wallet, request, chain } = await createTokenWallet();
      const normal = request.getMockImplementation()!;
      let codeReads = 0;
      request.mockImplementation(async (input) => {
        if (input.method === 'eth_getCode' && ++codeReads === 2) chain.provider = 43113n;
        return normal(input);
      });
      await expect(wallet.performTransfer(tokenTransfer)).rejects.toThrow(
        'provider chain mismatch',
      );
      expect(submissionCalls(request)).toEqual([]);
    });

    /**
     * @target performTransfer should reject malformed asset mapping %s before RPC
     * @dependencies real TokenMap with independent malformed and duplicate entries
     * @scenario alter the selected decimals, selected type, Ergo type, duplicate address or mapped residency
     * @expected policy rejection precedes account, balance, estimation and submission RPCs
     */
    it.each(['decimals', 'selected type', 'Ergo type', 'duplicate address', 'residency'] as const)(
      'should reject malformed asset mapping %s before RPC',
      async (fault) => {
        const { wallet, tokenMap, request } = await createTokenWallet();
        const raw = tokenMap.getRawConfig();
        if (fault === 'decimals') raw[1].avalanche.decimals = 19;
        if (fault === 'selected type') raw[1].avalanche.type = 'token';
        if (fault === 'Ergo type') raw[1].ergo.type = 'ERC-20';
        if (fault === 'residency') raw[1].avalanche.residency = 'unknown';
        if (fault === 'duplicate address')
          raw.push({
            avalanche: { ...joe, tokenId: joe.tokenId.toUpperCase().replace('0X', '0x') },
            ergo: { ...raw[1].ergo, tokenId: '77'.repeat(32) },
          });
        await tokenMap.updateConfigByJson(raw);
        await expect(wallet.performTransfer(tokenTransfer)).rejects.toThrow();
        expect(request).not.toHaveBeenCalled();
      },
    );

    /**
     * @target performTransfer should retain the pinned token input during funding
     * @dependencies real producer and synthetic gas-price RPC
     * @scenario change caller token, amount and custody while the funding requests are pending
     * @expected the send uses only the original selected asset and producer bytes
     */
    it('should retain the pinned token input during funding', async () => {
      const { wallet, request } = await createTokenWallet(8);
      const input = { ...tokenTransfer, token: { ...joe } };
      const normal = request.getMockImplementation()!;
      request.mockImplementation(async (rpc) => {
        if (rpc.method === 'eth_gasPrice') {
          input.token.tokenId = tokenTransfer.lockAddress;
          input.amount = 6n;
          input.lockAddress = exampleSender;
        }
        return normal(rpc);
      });
      await wallet.performTransfer(input);
      expect(submissionCalls(request)[0][0].params[0].data).toEqual(exampleCalldata);
      expect(submissionCalls(request)[0][0].params[0].to).toEqual(joe.tokenId);
    });

    /**
     * @target performTransfer should preserve token submission outcome %s
     * @dependencies synthetic terminal send errors after real qualification
     * @scenario isolate explicit denial and uncertain transport outcome
     * @expected only explicit denial reports user rejection, with one send and no retry
     */
    it.each([{ code: 4001 }, { code: -32000 }])(
      'should preserve token submission outcome %s',
      async (fault) => {
        const { wallet, request } = await createTokenWallet();
        const normal = request.getMockImplementation()!;
        request.mockImplementation(async (rpc) => {
          if (rpc.method === 'eth_sendTransaction') throw fault;
          return normal(rpc);
        });
        const error = await wallet.performTransfer(tokenTransfer).catch((value: unknown) => value);
        expect(error instanceof UserDeniedTransactionSignatureError).toEqual(fault.code === 4001);
        expect(error instanceof WalletError).toEqual(true);
        expect(submissionCalls(request)).toHaveLength(1);
      },
    );
  });
});
