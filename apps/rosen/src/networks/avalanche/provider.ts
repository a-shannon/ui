/** Delegate qualified C-Chain reads to the network package's existing provider contract. */
export {
  type AvalancheRpc as AvalancheAppRpc,
  createAvalancheEndpointProvider,
  createAvalancheProvider as createAvalancheAppProvider,
} from '@rosen-network/avalanche/server';
