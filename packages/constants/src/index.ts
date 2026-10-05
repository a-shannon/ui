export const TOKEN_NAME_PLACEHOLDER = 'unnamed token';

export const HEALTH_DATA_REFRESH_INTERVAL = 60000;

export const NETWORKS = {
  'avalanche': {
    index: undefined,
    key: 'avalanche',
    label: 'Avalanche C-Chain',
    nativeToken: 'avax',
    id: '',
    hasTokenSupport: true,
  },
  'binance': {
    index: 4,
    key: 'binance',
    label: 'Binance',
    nativeToken: 'bnb',
    id: '0x38',
    hasTokenSupport: true,
  },
  'bitcoin': {
    index: 2,
    key: 'bitcoin',
    label: 'Bitcoin',
    nativeToken: 'btc',
    id: '',
    hasTokenSupport: false,
  },
  'bitcoin-runes': {
    index: 6,
    key: 'bitcoin-runes',
    label: 'Bitcoin Runes',
    nativeToken: 'btc',
    id: '',
    hasTokenSupport: true,
  },
  'cardano': {
    index: 1,
    key: 'cardano',
    label: 'Cardano',
    nativeToken: 'ada',
    id: '',
    hasTokenSupport: true,
  },
  'ergo': {
    index: 0,
    key: 'ergo',
    label: 'Ergo',
    nativeToken: 'erg',
    id: '',
    hasTokenSupport: true,
  },
  'ethereum': {
    index: 3,
    key: 'ethereum',
    label: 'Ethereum',
    nativeToken: 'eth',
    id: '0x1',
    hasTokenSupport: true,
  },
  'doge': {
    index: 5,
    key: 'doge',
    label: 'Doge',
    nativeToken: 'doge',
    id: '',
    hasTokenSupport: false,
  },
  'firo': {
    index: 7,
    key: 'firo',
    label: 'Firo',
    nativeToken: 'firo',
    id: '',
    hasTokenSupport: false,
  },
  'handshake': {
    index: 8,
    key: 'handshake',
    label: 'Handshake',
    nativeToken: 'hns',
    id: '',
    hasTokenSupport: false,
  },
} as const;

export const NETWORKS_KEYS = Object.values(NETWORKS).map((network) => network.key);

// Base already owns this Rosen byte, although it is not offered by this UI.
export const RESERVED_ROSEN_CHAIN_INDEXES = [9] as const;
