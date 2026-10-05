import { describe, expect, it } from 'vitest';

import {
  assertAvalancheTransfer,
  avalancheQuantity,
  avalancheTransferGasReserve,
  buildAvalancheTransfer,
  qualifyAvalancheTransferGas,
} from '../src/transfer';
import { exampleCalldata, exampleLock, exampleMetadata, exampleSender, joe } from './erc20TestData';

describe('buildAvalancheTransfer', () => {
  /**
   * @target buildAvalancheTransfer should preserve the frozen token payload
   * @dependencies frozen JOE amount, addresses and metadata; no mocks
   * @scenario construct a direct token lock with one hundred billion raw units
   * @expected exact recipient, calldata suffix and mainnet identity are preserved
   */
  it('should preserve the frozen token payload', () => {
    expect(
      buildAvalancheTransfer(
        exampleSender,
        exampleLock,
        joe.tokenId,
        100000000000n,
        exampleMetadata,
        false,
        '0xa86a',
      ),
    ).toEqual({ from: exampleSender, to: joe.tokenId, data: exampleCalldata, chainId: '0xa86a' });
  });
});

describe('assertAvalancheTransfer', () => {
  /**
   * @target assertAvalancheTransfer should reject changed %s
   * @dependencies retained native payload; no mocks
   * @scenario independently replace one generated field
   * @expected every isolated payload mismatch is refused
   */
  it.each(['from', 'to', 'data', 'value', 'chainId'] as const)(
    'should reject changed %s',
    (field) => {
      const transaction = buildAvalancheTransfer(
        exampleSender,
        exampleLock,
        'avax',
        100000000000n,
        exampleMetadata,
        true,
        '0xa86a',
      );
      expect(() =>
        assertAvalancheTransfer({ ...transaction, [field]: '0x1' }, transaction),
      ).toThrow();
    },
  );
});

describe('avalancheQuantity', () => {
  /**
   * @target avalancheQuantity should reject noncanonical quantity %s
   * @dependencies synthetic RPC quantities; no mocks
   * @scenario independently supply padded, negative or uint256 overflow quantity
   * @expected invalid quantities cannot enter the funding calculation
   */
  it.each(['0x00', '-1', `0x1${'0'.repeat(64)}`])(
    'should reject noncanonical quantity %s',
    (quantity) => {
      expect(() => avalancheQuantity(quantity, 'gas price')).toThrow();
    },
  );
});

describe('qualifyAvalancheTransferGas', () => {
  /**
   * @target qualifyAvalancheTransferGas should preserve exact zero and nonzero byte costs
   * @dependencies synthetic two-byte calldata; no mocks
   * @scenario provide exactly 21020 gas for one zero and one nonzero byte
   * @expected the exact intrinsic cost is admitted without rounding
   */
  it('should preserve exact zero and nonzero byte costs', () => {
    expect(qualifyAvalancheTransferGas('0x521c', '0x00ff')).toEqual(21020n);
  });

  /**
   * @target qualifyAvalancheTransferGas should reject gas %s
   * @dependencies synthetic two-byte calldata; no mocks
   * @scenario independently supply zero, padded, below intrinsic or uint64 overflow gas
   * @expected invalid estimates cannot be used for submission
   */
  it.each(['0x0', '0x0521c', '0x521b', '0x10000000000000000'])('should reject gas %s', (gas) => {
    expect(() => qualifyAvalancheTransferGas(gas, '0x00ff')).toThrow();
  });
});

describe('avalancheTransferGasReserve', () => {
  /**
   * @target avalancheTransferGasReserve should preserve exact native reserve multiplication
   * @dependencies synthetic gas and price; no mocks
   * @scenario multiply gas 21020 by price25
   * @expected canonical gas price and exact reserve525500 are returned
   */
  it('should preserve exact native reserve multiplication', () => {
    expect(avalancheTransferGasReserve(21020n, '0x19')).toEqual({
      gasPrice: '0x19',
      reserve: 525500n,
    });
  });

  /**
   * @target avalancheTransferGasReserve should reject reserve boundary %s
   * @dependencies synthetic gas and price; no mocks
   * @scenario independently supply zero price or a product exceeding uint256
   * @expected an invalid reserve is never exposed
   */
  it.each(['zero', 'overflow'] as const)('should reject reserve boundary %s', (fault) => {
    expect(() =>
      avalancheTransferGasReserve(2n, fault === 'zero' ? '0x0' : `0x${'f'.repeat(64)}`),
    ).toThrow();
  });
});
