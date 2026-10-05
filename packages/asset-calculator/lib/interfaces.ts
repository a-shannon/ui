interface ErgoCalculatorInterface extends CalculatorInterface {
  explorerUrl: string;
}

/** Balance and supply readers must qualify canonical finalized execution. */
export interface AvalancheCalculatorSource {
  readonly expectedChainId: bigint;
  assertNetwork: () => Promise<void>;
  getAddressBalanceForNativeToken: (address: string) => Promise<bigint>;
  getAddressBalanceForERC20Asset?: (address: string, tokenId: string) => Promise<bigint>;
  getERC20AssetTotalSupply?: (tokenId: string) => Promise<bigint>;
}

/** Explicit AVAX and mapped standard ERC20 policy with independently configured sources. */
export interface AvalancheCalculatorInterface extends CalculatorInterface {
  chainId: 43113 | 43114;
  sourceId: string;
  source: AvalancheCalculatorSource;
}

interface CardanoCalculatorInterface extends CalculatorInterface {
  koiosUrl?: string;
  authToken?: string;
}
interface BitcoinCalculatorInterface extends CalculatorInterface {
  esploraUrl?: string;
}
interface BitcoinRunesCalculatorInterface extends CalculatorInterface {
  unisatUrl?: string;
  unisatApiKey?: string;
}

interface DogeCalculatorInterface extends CalculatorInterface {
  blockcypherUrl: string;
}

interface FiroCalculatorInterface extends CalculatorInterface {
  explorerUrl?: string;
}

interface EvmCalculatorInterface extends CalculatorInterface {
  rpcUrl: string;
  authToken?: string;
}

interface HandshakeCalculatorInterface extends CalculatorInterface {
  rpcUrl: string;
}

interface CalculatorInterface {
  addresses: string[];
}

export type {
  BitcoinCalculatorInterface,
  BitcoinRunesCalculatorInterface,
  CardanoCalculatorInterface,
  DogeCalculatorInterface,
  ErgoCalculatorInterface,
  EvmCalculatorInterface,
  FiroCalculatorInterface,
  HandshakeCalculatorInterface,
};
