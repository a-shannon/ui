import { vi } from 'vitest';

import { TokenMap } from '@rosen-bridge/tokens';
import { AvalancheNetwork } from '@rosen-network/avalanche';

import { createAvalancheAppActions } from '../../../src/networks/avalanche/actions';
import { createAvalancheAppProvider } from '../../../src/networks/avalanche/provider';
import { joe, metadata, sender } from './erc20TestData';
import { actionConfig, avax, lock } from './testData';

/** Real App provider, actions, TokenMap and network with only in-memory mainnet identity RPC. */
export const createTokenAppFixture = async () => {
  const map = new TokenMap();
  await map.updateConfigByJson([
    {
      avalanche: avax,
      ergo: { ...avax, tokenId: '55'.repeat(32), decimals: 8, type: 'token', residency: 'wrapped' },
    },
    {
      avalanche: joe,
      ergo: { ...joe, tokenId: '66'.repeat(32), decimals: 8, type: 'token', residency: 'wrapped' },
    },
  ]);
  const rpc = {
    send: vi.fn(async (method: string) => {
      if (method === 'eth_chainId') return '0xa86a';
      throw new Error(`Unexpected RPC in token producer fixture: ${method}`);
    }),
  };
  const provider = createAvalancheAppProvider(rpc, 43114);
  const config = { ...actionConfig, chainId: 43114 as const };
  const getTokenMap = vi.fn(async () => map);
  const actions = createAvalancheAppActions(config, provider, getTokenMap);
  const wallet = vi.fn(async () => 43114n);
  const network = new AvalancheNetwork({
    ...config,
    ...actions,
    getTokenMap,
    getWalletChainId: wallet,
  });
  const generate = () =>
    network.generateTxParameters(joe.tokenId, lock, sender, 10n, metadata, joe, 'avalanche');
  return { map, rpc, wallet, getTokenMap, actions, network, generate };
};

/** Match the generated mainnet overlay's EIP-004 labels and nine-decimal counterpart identities. */
export const createOfficialTokenAppFixture = async () => {
  const fixture = await createTokenAppFixture();
  const raw = fixture.map.getRawConfig();
  raw[0].ergo = { ...raw[0].ergo, tokenId: '0b'.repeat(32), decimals: 9, type: 'EIP-004' };
  raw[1].ergo = { ...raw[1].ergo, tokenId: '0c'.repeat(32), decimals: 9, type: 'EIP-004' };
  await fixture.map.updateConfigByJson(raw);
  return fixture;
};

/** Mutate one raw map obligation through the real TokenMap update API. */
export const changeMap = async (map: TokenMap, field: string) => {
  const raw = map.getRawConfig();
  const selected = raw[1];
  if (field === 'token type') selected.avalanche.type = 'native';
  if (field === 'raw decimals') selected.avalanche.decimals = 9;
  if (field === 'Ergo type') selected.ergo.type = 'native';
  if (field === 'Ergo residency') selected.ergo.residency = 'native';
  if (field === 'Ergo ID') selected.ergo.tokenId = '00'.repeat(32);
  if (field === 'duplicate token') raw.push({ ethereum: { ...selected.avalanche } });
  if (field === 'duplicate counterpart') raw.push({ ergo: { ...selected.ergo } });
  await map.updateConfigByJson(raw);
};
