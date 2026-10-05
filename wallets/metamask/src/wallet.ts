import type { MetaMaskSDK } from '@metamask/sdk';
import { Interface, isAddress } from 'ethers';

import type { RosenChainToken } from '@rosen-bridge/tokens';
import {
  AvalancheNetwork,
  assertAvalancheLockAmount,
  assertAvalancheToken,
  assertAvalancheTransfer,
  avalancheTransferGasReserve,
  buildAvalancheTransfer,
  captureAvalancheTokenPolicy,
  avalancheQuantity as decodeAvalancheQuantity,
  qualifyAvalancheTransferGas,
} from '@rosen-network/avalanche';
import { BinanceNetwork } from '@rosen-network/binance/dist/client';
import { EthereumNetwork } from '@rosen-network/ethereum/dist/client';
import { tokenABI } from '@rosen-network/evm/dist/constants';
import { NETWORKS } from '@rosen-ui/constants';
import type { Network } from '@rosen-ui/types';
import {
  ChainNotAddedError,
  ChainSwitchingRejectedError,
  CurrentChainError,
  InteractionError,
  UnsupportedChainError,
  UserDeniedTransactionSignatureError,
  Wallet,
  WalletError,
  type WalletTransferParams,
} from '@rosen-ui/wallet-api';

import { ICON } from './icon';
import type { MetaMaskWalletConfig } from './types';

const avalancheTokenInterface = new Interface([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
]);

/** Preserve wallet-facing error types while delegating pure chain calculations. */
const networkCalculation = <T>(calculate: () => T): T => {
  try {
    return calculate();
  } catch (error) {
    if (error instanceof Error) throw new WalletError(error.message);
    throw error;
  }
};

/** Decode a provider quantity through the network's exact integer rules. */
const avalancheQuantity = (value: unknown, label: string): bigint =>
  networkCalculation(() => decodeAvalancheQuantity(value, label));

export class MetaMaskWallet extends Wallet<MetaMaskWalletConfig> {
  /** Pin configured networks and require a single Avalanche deployment selection. */
  constructor(config: MetaMaskWalletConfig) {
    const networks = [...config.networks];
    if (networks.filter((network) => network instanceof AvalancheNetwork).length > 1) {
      throw new Error('Select one Avalanche C-Chain deployment per wallet');
    }
    Object.freeze(networks);
    super(Object.freeze({ ...config, networks }));
  }

  icon = ICON;

  name = 'MetaMask';

  label = 'MetaMask';

  link = 'https://metamask.io/';

  supportedChains: Network[] = [
    NETWORKS.binance.key,
    NETWORKS.ethereum.key,
    ...(this.config.networks.some((network) => network instanceof AvalancheNetwork)
      ? [NETWORKS.avalanche.key]
      : []),
  ];

  private _api?: MetaMaskSDK;

  /** Read the initialized browser SDK, rejecting unavailable browser interaction. */
  private get api(): MetaMaskSDK {
    if (typeof window === 'undefined' || !this._api) {
      throw new InteractionError(this.name);
    }
    return this._api;
  }

  /** Resolve the wallet's cached chain against configured Avalanche and existing networks. */
  get currentChain(): Network {
    const avalanche = this.config.networks.find((network) => network instanceof AvalancheNetwork);
    if (
      avalanche instanceof AvalancheNetwork &&
      this.provider.chainId === `0x${avalanche.chainId.toString(16)}`
    ) {
      return NETWORKS.avalanche.key;
    }
    const chain = Object.values(NETWORKS).find(
      (network) => network.id && network.id === this.provider.chainId,
    )?.key;

    if (!chain) throw new CurrentChainError(this.name);

    return chain;
  }

  /** Obtain the current provider from the active SDK after availability checks. */
  private get provider() {
    this.requireAvailable();

    const provider = this.api.getProvider();

    if (!provider) throw new InteractionError(this.name);

    return provider;
  }

  /** Read the active SDK provider's chain for the configured network facade. */
  getEvmChainId = async (): Promise<bigint> => {
    const value = await this.provider.request<string>({ method: 'eth_chainId' });
    if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value)) {
      throw new WalletError('Invalid wallet chain ID');
    }
    return BigInt(value);
  };

  /** Read the provider's current wallet permissions. */
  private permissions = async () => {
    return (await this.provider.request({
      method: 'wallet_getPermissions',
      params: [],
    })) as { caveats: { type: string; value: string[] }[] }[];
  };

  /** Refuse EIP-7702 delegated accounts and disconnect an incompatible session. */
  private requireStandardAccount = async (): Promise<void> => {
    const address = await this.fetchAddress();

    if (!address) return;

    const code = await this.provider.request<string>({
      method: 'eth_getCode',
      params: [address, 'latest'],
    });

    if (!code?.toLowerCase().startsWith('0xef0100')) return;

    try {
      await this.api.disconnect();
    } catch {
      //
    }

    throw new WalletError(
      [
        "This account is a MetaMask Smart Account and can't be used right now",
        "Rosen can't yet process transfers sent from smart accounts (EIP-7702). If you continue, your tokens will reach the bridge address but the transfer will not be detected, and recovering them will require manual support.",
        'To continue, switch this account back to a standard account in MetaMask: Account menu (⋮) → Account details → Smart account → turn off the toggle for this network, then reload this page. Your address, funds and Secret Recovery Phrase do not change.',
      ].join('\n'),
    );
  };

  /** Lazily construct and initialize the browser SDK once for this wallet. */
  initialize = async (): Promise<void> => {
    if (this.isInitialized) return;

    /**
     * Lazy-load wallet resource to reduce initial bundle size and improve app startup performance
     */
    const { MetaMaskSDK } = await import('@metamask/sdk');

    this._api ||= new MetaMaskSDK({
      dappMetadata: {
        name: 'Rosen Bridge',
        url: window.location.origin,
      },
      enableAnalytics: false,
    });

    await this.api.init();

    this.isInitialized = true;
  };

  /** Request connection through the initialized SDK. */
  performConnect = async (): Promise<void> => {
    await this.api.connect();
  };

  /** Disconnect the active SDK session. */
  performDisconnect = async (): Promise<void> => {
    await this.api.disconnect();
  };

  /** Read the first currently exposed account from the active provider. */
  fetchAddress = async (): Promise<string | undefined> => {
    const accounts = await this.provider.request<string[]>({
      method: 'eth_accounts',
    });
    return accounts?.at(0);
  };

  /** Read the mapped Avalanche asset through the same SDK provider as the wallet account. */
  fetchBalance = async (token: RosenChainToken): Promise<string | undefined | null> => {
    const network = this.currentNetwork;
    if (network instanceof AvalancheNetwork) {
      assertAvalancheToken(token);
      const pinnedToken = Object.freeze({ ...token });
      const tokenMap = await this.config.getTokenMap();
      const policy = captureAvalancheTokenPolicy(tokenMap, pinnedToken);
      const provider = this.provider;
      const address = await this.getAddress();
      if (!isAddress(address)) throw new WalletError('Invalid Avalanche wallet account');
      const selectedChain = `0x${network.chainId.toString(16)}`;
      await this.assertAvalancheWalletIdentity(provider, selectedChain, address);
      const balance = policy.isNative
        ? avalancheQuantity(
            await provider.request<string>({
              method: 'eth_getBalance',
              params: [address, 'latest'],
            }),
            'native AVAX balance',
          )
        : await this.readAvalancheTokenBalance(provider, pinnedToken.tokenId, address);
      if ((await this.config.getTokenMap()) !== tokenMap) {
        throw new WalletError('Avalanche token map changed');
      }
      await this.assertAvalancheWalletIdentity(provider, selectedChain, address);
      policy.assertCurrent();
      if (this.provider !== provider) throw new WalletError('Avalanche wallet provider changed');
      return `0x${balance.toString(16)}`;
    }
    const { BrowserProvider, Contract } = await import('ethers');

    const address = await this.getAddress();

    let amount: string | undefined | null;

    if (token.type === 'native') {
      amount = await this.provider.request<string>({
        method: 'eth_getBalance',
        params: [address, 'latest'],
      });
    } else {
      const browserProvider = new BrowserProvider(window.ethereum!);

      const contract = new Contract(token.tokenId, tokenABI, await browserProvider.getSigner());

      amount = await contract.balanceOf(address);
    }

    return amount;
  };

  /** Report whether the SDK can interact with an active MetaMask extension. */
  isAvailable = (): boolean => {
    return this.api.isExtensionActive();
  };

  /** Report a connected session from the provider's current permissions. */
  hasConnection = async (): Promise<boolean> => {
    return !!(await this.permissions()).length;
  };

  /** Switch to the selected deployment, retaining the existing permission/error policy. */
  performSwitchChain = async (chain: Network, silent?: boolean): Promise<void> => {
    const avalanche = this.config.networks.find((network) => network instanceof AvalancheNetwork);
    if (chain === NETWORKS.avalanche.key && !(avalanche instanceof AvalancheNetwork)) {
      throw new UnsupportedChainError(this.name, chain);
    }
    const chainId =
      chain === NETWORKS.avalanche.key && avalanche instanceof AvalancheNetwork
        ? `0x${avalanche.chainId.toString(16)}`
        : NETWORKS[chain].id;

    if (silent) {
      const has = (await this.permissions())
        .flatMap((permission) => permission.caveats)
        .some(
          (caveat) => caveat.type === 'restrictNetworkSwitching' && caveat.value.includes(chainId),
        );

      if (!has) throw new Error();
    }

    try {
      await this.provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId }],
      });
    } catch (error) {
      /**
       * TODO: remove the inline Biome comment
       * local:ergo/rosen-bridge/ui#441
       */
      // biome-ignore lint/suspicious/noExplicitAny: Use a better type
      switch ((error as any)?.code) {
        case 4001:
          throw new ChainSwitchingRejectedError(this.name, chain, error);
        case 4902:
          throw new ChainNotAddedError(this.name, chain, error);
        default:
          throw error;
      }
    }

    if (chain === NETWORKS.avalanche.key) {
      const actualChain = await this.provider.request<string>({ method: 'eth_chainId' });
      if (actualChain !== chainId) throw new CurrentChainError(this.name);
    }
    await this.requireStandardAccount();
  };

  /** Route a transfer through the selected network's transaction construction. */
  performTransfer = async (params: WalletTransferParams): Promise<string> => {
    const currentNetwork = this.currentNetwork;
    if (currentNetwork instanceof AvalancheNetwork) {
      return await this.performAvalancheTransfer(params, currentNetwork);
    }
    if (
      !(this.currentNetwork instanceof BinanceNetwork) &&
      !(this.currentNetwork instanceof EthereumNetwork)
    ) {
      throw new UnsupportedChainError(this.name, this.currentChain);
    }

    await this.requireStandardAccount();

    const address = await this.getAddress();

    const rosenData = await this.currentNetwork.generateLockData(
      params.toChain,
      params.address,
      params.networkFee.toString(),
      params.bridgeFee.toString(),
    );

    const transactionParameters = await this.currentNetwork.generateTxParameters(
      params.token.tokenId,
      params.lockAddress,
      address,
      params.amount,
      rosenData,
      params.token,
      params.fromChain,
    );

    try {
      return (await this.provider.request<string>({
        method: 'eth_sendTransaction',
        params: [transactionParameters],
      }))!;
    } catch (error) {
      throw new UserDeniedTransactionSignatureError(this.name, error);
    }
  };

  /** Qualify the selected asset, separate AVAX gas funding and exact lock before submission. */
  private performAvalancheTransfer = async (
    params: WalletTransferParams,
    network: AvalancheNetwork,
  ): Promise<string> => {
    const provider = this.provider;
    const selectedChain = `0x${network.chainId.toString(16)}`;
    const pinned = Object.freeze({ ...params, token: Object.freeze({ ...params.token }) });
    assertAvalancheToken(pinned.token);
    if (
      pinned.fromChain !== NETWORKS.avalanche.key ||
      !isAddress(pinned.lockAddress) ||
      pinned.lockAddress.toLowerCase() !== network.lockAddress.toLowerCase() ||
      typeof pinned.amount !== 'bigint' ||
      pinned.amount <= 0n
    ) {
      throw new WalletError('Invalid Avalanche transfer');
    }
    assertAvalancheLockAmount(pinned.amount, pinned.bridgeFee, pinned.networkFee);
    const tokenMap = await this.config.getTokenMap();
    const tokenPolicy = captureAvalancheTokenPolicy(tokenMap, pinned.token);
    const address = await this.getAddress();
    if (!isAddress(address)) throw new WalletError('Invalid Avalanche wallet account');
    const code = await provider.request<string>({
      method: 'eth_getCode',
      params: [address, 'latest'],
    });
    if (code !== '0x') {
      throw new WalletError('Avalanche transfers require a standard account');
    }
    const rawAmount = tokenPolicy.unwrapAmount(pinned.amount).amount;
    if (typeof rawAmount !== 'bigint' || rawAmount <= 0n || rawAmount >= 1n << 256n) {
      throw new WalletError('Invalid Avalanche amount');
    }
    const rosenData = await network.generateLockData(
      pinned.toChain,
      pinned.address,
      pinned.networkFee.toString(),
      pinned.bridgeFee.toString(),
    );
    const generated = await network.generateTxParameters(
      pinned.token.tokenId,
      pinned.lockAddress,
      address,
      pinned.amount,
      rosenData,
      pinned.token,
      pinned.fromChain,
    );
    tokenPolicy.assertCurrent();
    const transaction = networkCalculation(() =>
      buildAvalancheTransfer(
        address,
        pinned.lockAddress,
        pinned.token.tokenId,
        rawAmount,
        rosenData,
        tokenPolicy.isNative,
        selectedChain,
      ),
    );
    /** Retain the exact expected payload across all asynchronous qualification reads. */
    const assertPayload = (candidate: typeof generated): void =>
      networkCalculation(() => assertAvalancheTransfer(candidate, transaction));
    assertPayload(generated);
    await this.assertAvalancheWalletIdentity(provider, selectedChain, address);
    tokenPolicy.assertCurrent();
    const estimatedGas = await provider.request<string>({
      method: 'eth_estimateGas',
      params: [transaction],
    });
    const gas = networkCalculation(() =>
      qualifyAvalancheTransferGas(estimatedGas, transaction.data),
    );
    let gasPrice: string | undefined;
    if (!tokenPolicy.isNative) {
      const quote = await provider.request<string>({ method: 'eth_gasPrice' });
      const funding = networkCalculation(() => avalancheTransferGasReserve(gas, quote));
      gasPrice = funding.gasPrice;
      const reserve = funding.reserve;
      const tokenBalance = await this.readAvalancheTokenBalance(
        provider,
        pinned.token.tokenId,
        address,
      );
      if (tokenBalance < rawAmount) throw new WalletError('Insufficient Avalanche token balance');
      const avaxBalance = avalancheQuantity(
        await provider.request<string>({
          method: 'eth_getBalance',
          params: [address, 'latest'],
        }),
        'native AVAX balance',
      );
      if (avaxBalance < reserve) throw new WalletError('Insufficient native AVAX for gas');
    }
    const currentCode = await provider.request<string>({
      method: 'eth_getCode',
      params: [address, 'latest'],
    });
    if (currentCode !== '0x') {
      throw new WalletError('Avalanche transfers require a standard account');
    }
    if (!tokenPolicy.isNative) {
      // Requalify the network provider and its wallet-chain reader after all funding/code RPCs.
      assertPayload(
        await network.generateTxParameters(
          pinned.token.tokenId,
          pinned.lockAddress,
          address,
          pinned.amount,
          rosenData,
          pinned.token,
          pinned.fromChain,
        ),
      );
      if ((await this.config.getTokenMap()) !== tokenMap) {
        throw new WalletError('Avalanche token map changed');
      }
    }
    await this.assertAvalancheWalletIdentity(provider, selectedChain, address);
    tokenPolicy.assertCurrent();
    if (this.provider !== provider) throw new WalletError('Avalanche wallet provider changed');
    let hash: unknown;
    try {
      hash = await provider.request<string>({
        method: 'eth_sendTransaction',
        params: [{ ...transaction, gas: estimatedGas, ...(gasPrice ? { gasPrice } : {}) }],
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 4001) {
        throw new UserDeniedTransactionSignatureError(this.name, error);
      }
      throw new WalletError(
        'Avalanche submission could not be confirmed. Check wallet activity before sending again.',
        { cause: error },
      );
    }
    if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      throw new WalletError(
        'Avalanche wallet returned an invalid transaction ID. Check wallet activity before sending again.',
      );
    }
    return hash;
  };

  /** Read an exact ABI uint256 balance without switching to window.ethereum. */
  private readAvalancheTokenBalance = async (
    provider: NonNullable<ReturnType<MetaMaskSDK['getProvider']>>,
    tokenId: string,
    address: string,
  ): Promise<bigint> => {
    const response = await provider.request<string>({
      method: 'eth_call',
      params: [
        { to: tokenId, data: avalancheTokenInterface.encodeFunctionData('balanceOf', [address]) },
        'latest',
      ],
    });
    if (typeof response !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(response)) {
      throw new WalletError('Invalid Avalanche token balance');
    }
    return BigInt(response);
  };

  /** Observe both wallet chain and selected account at the submission boundary. */
  private assertAvalancheWalletIdentity = async (
    provider: NonNullable<ReturnType<MetaMaskSDK['getProvider']>>,
    selectedChain: string,
    address: string,
  ): Promise<void> => {
    const accounts = await provider.request<string[]>({ method: 'eth_accounts' });
    const chain = await provider.request<string>({ method: 'eth_chainId' });
    if (
      chain !== selectedChain ||
      !Array.isArray(accounts) ||
      typeof accounts[0] !== 'string' ||
      accounts[0].toLowerCase() !== address.toLowerCase()
    ) {
      throw new WalletError('Avalanche wallet chain or account changed');
    }
  };
}
