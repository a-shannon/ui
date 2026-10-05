import { vi } from 'vitest';

import { DummyLogger } from '@rosen-bridge/abstract-logger';
import { DataSource } from '@rosen-bridge/extended-typeorm';
import {
  AssetCalculator,
  BridgedAssetEntity,
  LockedAssetEntity,
  migrations,
  TokenEntity,
} from '@rosen-ui/asset-calculator';

import { createCalculatorFixture } from './testUtils';

/** Construct the actual Service -> RPC -> AssetCalculator -> SQLite consumer chain. */
export const storedCalculatorFixture = async (wrapped = false) => {
  const service = await createCalculatorFixture(true, wrapped);
  const database = new DataSource({
    type: 'sqlite',
    database: ':memory:',
    entities: [BridgedAssetEntity, LockedAssetEntity, TokenEntity],
    migrations: migrations.sqlite,
  });
  await database.initialize();
  await database.runMigrations();
  const asset = storedCalculator(service, database);
  return { ...service, database, asset };
};

/** Share the actual calculator consumer construction across explicit database engines. */
export const storedCalculator = (
  service: Pick<Awaited<ReturnType<typeof createCalculatorFixture>>, 'tokenMap' | 'calculator'>,
  database: DataSource,
) => {
  const asset = new AssetCalculator(
    service.tokenMap,
    { addresses: ['synthetic-ergo-custody'], explorerUrl: 'https://ergo.example.invalid' },
    { addresses: [], koiosUrl: 'https://cardano.example.invalid' },
    { addresses: [], esploraUrl: 'https://bitcoin.example.invalid' },
    { addresses: [], unisatUrl: 'https://runes.example.invalid' },
    { addresses: [], rpcUrl: 'https://ethereum.example.invalid' },
    { addresses: [], rpcUrl: 'https://binance.example.invalid' },
    { addresses: [], blockcypherUrl: 'https://doge.example.invalid' },
    { addresses: [], explorerUrl: 'https://firo.example.invalid' },
    { addresses: [], rpcUrl: 'https://handshake.example.invalid' },
    database,
    new DummyLogger(),
    service.calculator,
  );
  // Unchanged chains are source doubles; Avalanche accounting and persistence remain real.
  const ergo = asset['calculatorMap'].get('ergo')! as unknown as {
    explorerApi: {
      v1: {
        getApiV1TokensP1: (id: string) => Promise<unknown>;
        getApiV1AddressesP1BalanceConfirmed: (address: string) => Promise<unknown>;
      };
    };
  };
  ergo.explorerApi.v1.getApiV1TokensP1 = vi.fn(async () => ({ emissionAmount: 1000n }));
  ergo.explorerApi.v1.getApiV1AddressesP1BalanceConfirmed = vi.fn(async () => ({
    nanoErgs: 0n,
    tokens: [],
  }));
  const ethereum = asset['calculatorMap'].get('ethereum')!;
  ethereum.totalRawBalance = vi.fn(async () => 0n);
  ethereum.getRawLockedAmountsPerAddress = vi.fn(async () => []);
  return asset;
};
