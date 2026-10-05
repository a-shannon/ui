import { createAvalancheActions } from '../src/actions';
import { exampleLock } from './erc20TestData';
import { createMixedMap } from './erc20TestUtils';
import { createProviderMock } from './mocked/provider.mock';

/** Real lock producers and mixed TokenMap with only provider API reads mocked. */
export const createActionsFixture = async () => {
  const map = await createMixedMap();
  const provider = createProviderMock();
  const actions = createAvalancheActions(
    {
      chainId: 43113,
      lockAddress: exampleLock,
      nextHeightInterval: 50,
      rosenChainIndex: 100,
      gasReserveLimit: 30000n,
    },
    provider,
    async () => map,
  );
  return { actions, map, provider };
};
