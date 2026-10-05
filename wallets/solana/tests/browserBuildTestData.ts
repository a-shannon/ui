import { ergoDestination } from './testData';

/** Shared Node/browser address-policy fixtures; P2S 00ff retains current address-only acceptance. */
export const browserAddressTestData: {
  address: string;
  network: 'mainnet' | 'testnet';
  accepted: boolean;
}[] = [
  { address: ergoDestination, network: 'mainnet', accepted: true },
  { address: ergoDestination, network: 'testnet', accepted: false },
  {
    address: '3Wwfn5BfMSNdmUtVxdCrCnYyeE1fL9jeQb765egLpg5jpCca2r7J',
    network: 'testnet',
    accepted: true,
  },
  { address: `${ergoDestination.slice(0, -1)}1`, network: 'mainnet', accepted: false },
  { address: 'SaMb8i', network: 'mainnet', accepted: false },
  { address: '7bwTXgy56', network: 'mainnet', accepted: true },
  { address: '2KwKFjHS8i', network: 'mainnet', accepted: false },
  { address: ` ${ergoDestination}`, network: 'mainnet', accepted: false },
  { address: `${ergoDestination}\n`, network: 'mainnet', accepted: false },
];
