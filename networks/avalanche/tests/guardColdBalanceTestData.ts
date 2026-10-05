/** Matches the Guard source-owned SQLite/TokenMap/Fastify fixture. */
export const backendColdFixture = {
  chainId: 43114,
  hot: {
    total: 2,
    items: [
      {
        chain: 'avalanche',
        address: '0xabababababababababababababababababababab',
        balance: {
          tokenId: '0x6e84a6216ea6dacc71ee8e6b0a5b7322eebc0fdd',
          name: 'JOE',
          amount: '9007199254740993123456789',
          decimals: 6,
          isNativeToken: false,
        },
      },
      {
        chain: 'avalanche',
        address: '0xabababababababababababababababababababab',
        balance: {
          tokenId: 'avax',
          name: 'AVAX',
          amount: '100000000000',
          decimals: 9,
          isNativeToken: true,
        },
      },
    ],
  },
  cold: {
    total: 2,
    items: [
      {
        chain: 'avalanche',
        address: '0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
        balance: {
          tokenId: '0x6e84a6216ea6dacc71ee8e6b0a5b7322eebc0fdd',
          name: 'JOE',
          amount: '9007199254740993999999999',
          decimals: 6,
          isNativeToken: false,
        },
      },
      {
        chain: 'avalanche',
        address: '0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
        balance: {
          tokenId: 'avax',
          name: 'AVAX',
          amount: '500000000000',
          decimals: 9,
          isNativeToken: true,
        },
      },
    ],
  },
};
