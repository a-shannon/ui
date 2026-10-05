import { vi } from 'vitest';

import type { AvalancheChainId } from '@rosen-network/avalanche';

import { sender } from '../testData';

export type ProviderRequest = { method: string; params?: unknown };

/** Count submission calls without issuing a real wallet request. */
export const submissionCalls = (request: ReturnType<typeof vi.fn>) => {
  return request.mock.calls.filter(([input]) => input.method === 'eth_sendTransaction');
};

/** Create only synthetic EIP-1193 and SDK API replies for the selected chain. */
export const createProviderMock = (chainId: AvalancheChainId = 43113) => {
  const request = vi.fn(async (input: ProviderRequest): Promise<unknown> => {
    switch (input.method) {
      case 'eth_accounts':
        return [sender];
      case 'eth_chainId':
        return `0x${chainId.toString(16)}`;
      case 'eth_getCode':
        return '0x';
      case 'wallet_getPermissions':
        return [{ caveats: [] }];
      case 'eth_estimateGas':
        return '0x7530';
      case 'eth_sendTransaction':
        return `0x${'44'.repeat(32)}`;
      case 'wallet_switchEthereumChain':
        return undefined;
      case 'eth_getBalance':
        return '0x2540be400';
      default:
        throw new Error(`Unexpected synthetic request: ${input.method}`);
    }
  });
  const provider = { chainId: `0x${chainId.toString(16)}`, request };
  const sdk = { getProvider: () => provider, isExtensionActive: () => true };
  return { request, provider, sdk };
};
