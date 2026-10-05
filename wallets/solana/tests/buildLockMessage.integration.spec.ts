import { describe, expect, it } from 'vitest';

import { buildSolanaLockMessage } from '@rosen-network/solana';

import { signSolanaLockTransaction } from '../src/signerPort';
import { makeLockRpcFixture, makeRealExtractor, replaceLockMemo } from './lockRoundTripTestUtils';
import { mockSyntheticSigner } from './mocked/signerPort.mock';
import { ergoDestination, keypair, nativeProfile, splProfile } from './testUtils';

describe('buildSolanaLockMessage', () => {
  /**
   * @target buildSolanaLockMessage round trips signed source messages through the real extractor (%s)
   * @dependencies
   * - actual web3/SPL compiler and companion SolanaRosenExtractor/TokenMap
   * - synthetic wallet port mock and deterministic simulated finalized RPC/history
   * @scenario
   * - build a SOL or original SPL message and sign its exact bytes
   * - derive the RPC transaction from its compiled message and signature
   * - attach simulated balance/history evidence and run the actual extractor
   * @expected
   * - amount, asset, fees, destination, authority and source signature survive
   */
  it.each(['SOL', 'SPL'])(
    'round trips signed source messages through the real extractor (%s)',
    async (kind) => {
      const sender = keypair(113);
      const mint = keypair(127).publicKey.toBase58();
      const sourceTokenAccount = keypair(131).publicKey.toBase58();
      const profile =
        kind === 'SOL' ? nativeProfile() : splProfile(mint, keypair(137).publicKey.toBase58());
      const asset = kind === 'SOL' ? 'SOL' : mint;
      const build = buildSolanaLockMessage(profile, {
        asset,
        grossAmount: '1000000',
        destinationAddress: ergoDestination,
        senderAddress: sender.publicKey.toBase58(),
        recentBlockhash: keypair(149).publicKey.toBase58(),
        ...(kind === 'SPL' ? { sourceTokenAccount } : {}),
      });
      const signed = await signSolanaLockTransaction(build, mockSyntheticSigner(sender));
      const fixture = makeLockRpcFixture(signed, profile, asset);
      const extractor = await makeRealExtractor(profile);
      const outcome = extractor.getWithContext(JSON.stringify(fixture));
      expect(outcome.reason).toEqual(undefined);
      expect(outcome).toMatchObject({ type: 'deposit' });
      expect(outcome.data).toMatchObject({
        toChain: 'ergo',
        toAddress: ergoDestination,
        amount: '1000000',
        networkFee: '100',
        bridgeFee: '200',
        fromAddress: sender.publicKey.toBase58(),
        sourceChainTokenId: kind === 'SOL' ? 'sol' : mint,
        targetChainTokenId: profile.assets[asset].destinationTokenId,
        sourceTxId: fixture.transaction.signatures[0],
      });
      expect(outcome.context).toEqual({
        clusterGenesisHash: profile.clusterGenesisHash,
        sourceTxId: fixture.transaction.signatures[0],
        sourceSlot: fixture.slot,
        sourceBlockhash: fixture.blockhash,
      });
    },
  );

  /**
   * @target buildSolanaLockMessage rejects altered amount, asset, destination and instruction order downstream (%s/%s)
   * @dependencies
   * - actual companion SolanaRosenExtractor; deterministic simulated RPC/history
   * - synthetic wallet port mock; no endpoint requests
   * @scenario
   * - build and sign the same valid SOL or SPL lock
   * - mutate exactly one Memo binding or reverse the instruction order
   * - run the actual extractor against that single-fault projection
   * @expected
   * - every altered projection fails to produce a deposit
   */
  it.each([
    ['SOL', 'amount'],
    ['SOL', 'asset'],
    ['SOL', 'destination'],
    ['SOL', 'order'],
    ['SPL', 'amount'],
    ['SPL', 'asset'],
    ['SPL', 'destination'],
    ['SPL', 'order'],
  ])(
    'rejects altered amount, asset, destination and instruction order downstream (%s/%s)',
    async (kind, field) => {
      const sender = keypair(113);
      const mint = keypair(127).publicKey.toBase58();
      const profile =
        kind === 'SOL' ? nativeProfile() : splProfile(mint, keypair(137).publicKey.toBase58());
      const asset = kind === 'SOL' ? 'SOL' : mint;
      const build = buildSolanaLockMessage(profile, {
        asset,
        grossAmount: '1000000',
        destinationAddress: ergoDestination,
        senderAddress: sender.publicKey.toBase58(),
        recentBlockhash: keypair(149).publicKey.toBase58(),
        ...(kind === 'SPL' ? { sourceTokenAccount: keypair(131).publicKey.toBase58() } : {}),
      });
      const signed = await signSolanaLockTransaction(build, mockSyntheticSigner(sender));
      const fixture = makeLockRpcFixture(signed, profile, asset);
      if (field === 'order') fixture.transaction.message.instructions.reverse();
      if (field === 'amount') replaceLockMemo(fixture, { amount: '1000001' });
      if (field === 'asset') replaceLockMemo(fixture, { asset: keypair(151).publicKey.toBase58() });
      if (field === 'destination') replaceLockMemo(fixture, { toAddress: 'invalid-ergo' });
      const outcome = (await makeRealExtractor(profile)).getWithContext(JSON.stringify(fixture));
      expect(outcome.type).toEqual('not-deposit');
      expect(outcome.reason).toEqual(
        field === 'order'
          ? 'NOT_BRIDGE_INSTRUCTION_PAIR'
          : field === 'destination'
            ? 'DESTINATION'
            : 'MEMO_PAYMENT',
      );
    },
  );
});
