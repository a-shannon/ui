import { SystemProgram, type Transaction } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import { buildSolanaLockMessage, hasCapturedSolanaLockMessage } from '@rosen-network/solana';

import { signSolanaLockTransaction } from '../src/signerPort';
import { mockSyntheticSigner } from './mocked/signerPort.mock';
import { ergoDestination, keypair, nativeProfile } from './testUtils';

describe('signSolanaLockTransaction', () => {
  /**
   * @target signSolanaLockTransaction preserves the exact message through signing
   * @dependencies
   * - synthetic signer port mock; actual web3.js Ed25519 verification
   * @scenario
   * - build a native transfer and sign a detached wallet transaction
   * - inspect signature validity, original unsigned state and message identity
   * @expected
   * - the signed clone verifies and the original remains unsigned
   */
  it('preserves the exact message through signing', async () => {
    const sender = keypair(113);
    const build = buildSolanaLockMessage(nativeProfile(), {
      asset: 'SOL',
      grossAmount: '1000000',
      destinationAddress: ergoDestination,
      senderAddress: sender.publicKey.toBase58(),
      recentBlockhash: keypair(121).publicKey.toBase58(),
    });
    const port = mockSyntheticSigner(sender);
    const signed = await signSolanaLockTransaction(build, port);
    expect(signed).not.toBe(build.transaction);
    expect(signed.verifySignatures()).toEqual(true);
    expect(hasCapturedSolanaLockMessage(build, signed)).toEqual(true);
    expect(build.transaction.signatures.every(({ signature }) => signature === null)).toEqual(true);
    expect(port.signTransaction).toHaveBeenCalledTimes(1);
  });

  /**
   * @target signSolanaLockTransaction rejects a disconnected or different wallet (%s)
   * @dependencies
   * - synthetic signer port mock and actual message builder
   * @scenario
   * - vary only the wallet key while keeping the unsigned message unchanged
   * @expected
   * - signing is rejected before invoking the wallet
   */
  it.each([null, keypair(133).publicKey.toBase58()])(
    'rejects a disconnected or different wallet (%s)',
    async (walletKey) => {
      const sender = keypair(113);
      const build = buildSolanaLockMessage(nativeProfile(), {
        asset: 'SOL',
        grossAmount: '1000000',
        destinationAddress: ergoDestination,
        senderAddress: sender.publicKey.toBase58(),
        recentBlockhash: keypair(121).publicKey.toBase58(),
      });
      const port = mockSyntheticSigner(sender);
      port.getPublicKey.mockReturnValue(walletKey);
      await expect(signSolanaLockTransaction(build, port)).rejects.toThrow(Error);
      expect(port.signTransaction).not.toHaveBeenCalled();
    },
  );

  /**
   * @target signSolanaLockTransaction rejects mutation before signing
   * @dependencies
   * - synthetic signer port mock; actual System Program instruction
   * @scenario
   * - change only the payment amount after construction
   * @expected
   * - the wallet is never invoked
   */
  it('rejects mutation before signing', async () => {
    const sender = keypair(113);
    const build = buildSolanaLockMessage(nativeProfile(), {
      asset: 'SOL',
      grossAmount: '1000000',
      destinationAddress: ergoDestination,
      senderAddress: sender.publicKey.toBase58(),
      recentBlockhash: keypair(121).publicKey.toBase58(),
    });
    build.transaction.instructions[0].data[4] ^= 1;
    const port = mockSyntheticSigner(sender);
    await expect(signSolanaLockTransaction(build, port)).rejects.toThrow(Error);
    expect(port.signTransaction).not.toHaveBeenCalled();
  });

  /**
   * @target signSolanaLockTransaction rejects wallet mutation during signing
   * @dependencies
   * - synthetic signer port mock and actual legacy message serialization
   * @scenario
   * - wallet adds a payment instruction and signs that altered message
   * @expected
   * - a valid signature on a different message is rejected
   */
  it('rejects wallet mutation during signing', async () => {
    const sender = keypair(113);
    const build = buildSolanaLockMessage(nativeProfile(), {
      asset: 'SOL',
      grossAmount: '1000000',
      destinationAddress: ergoDestination,
      senderAddress: sender.publicKey.toBase58(),
      recentBlockhash: keypair(121).publicKey.toBase58(),
    });
    const port = mockSyntheticSigner(sender);
    port.signTransaction.mockImplementation(async (transaction) => {
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: sender.publicKey,
          toPubkey: keypair(141).publicKey,
          lamports: 1n,
        }),
      );
      transaction.partialSign(sender);
      return transaction;
    });
    await expect(signSolanaLockTransaction(build, port)).rejects.toThrow(Error);
  });

  /**
   * @target signSolanaLockTransaction rejects a wallet switch during signing
   * @dependencies
   * - synthetic signer port mock; actual Ed25519 signature
   * @scenario
   * - return a valid signed message after the connected public key changes
   * @expected
   * - the stale wallet response is rejected
   */
  it('rejects a wallet switch during signing', async () => {
    const sender = keypair(113);
    const build = buildSolanaLockMessage(nativeProfile(), {
      asset: 'SOL',
      grossAmount: '1000000',
      destinationAddress: ergoDestination,
      senderAddress: sender.publicKey.toBase58(),
      recentBlockhash: keypair(121).publicKey.toBase58(),
    });
    const port = mockSyntheticSigner(sender);
    port.getPublicKey
      .mockReturnValueOnce(sender.publicKey.toBase58())
      .mockReturnValue(keypair(151).publicKey.toBase58());
    await expect(signSolanaLockTransaction(build, port)).rejects.toThrow(Error);
  });

  /**
   * @target signSolanaLockTransaction rejects missing and corrupted signatures (%s)
   * @dependencies
   * - synthetic signer port mock; actual web3.js signature verifier
   * @scenario
   * - return unchanged message bytes with an absent or corrupted signature
   * @expected
   * - message identity alone cannot authorize the transaction
   */
  it.each(['absent', 'corrupted'])(
    'rejects missing and corrupted signatures (%s)',
    async (mode) => {
      const sender = keypair(113);
      const build = buildSolanaLockMessage(nativeProfile(), {
        asset: 'SOL',
        grossAmount: '1000000',
        destinationAddress: ergoDestination,
        senderAddress: sender.publicKey.toBase58(),
        recentBlockhash: keypair(121).publicKey.toBase58(),
      });
      const port = mockSyntheticSigner(sender);
      port.signTransaction.mockImplementation(async (transaction) => {
        if (mode === 'corrupted') {
          transaction.partialSign(sender);
          transaction.signatures[0].signature?.fill(0);
        }
        return transaction;
      });
      await expect(signSolanaLockTransaction(build, port)).rejects.toThrow(Error);
    },
  );

  /**
   * @target signSolanaLockTransaction rejects an already signed builder transaction
   * @dependencies
   * - synthetic signer port mock; actual Ed25519 signing
   * @scenario
   * - sign the builder transaction before passing it to the signer port
   * @expected
   * - a second signing request is rejected before the wallet is called
   */
  it('rejects an already signed builder transaction', async () => {
    const sender = keypair(113);
    const build = buildSolanaLockMessage(nativeProfile(), {
      asset: 'SOL',
      grossAmount: '1000000',
      destinationAddress: ergoDestination,
      senderAddress: sender.publicKey.toBase58(),
      recentBlockhash: keypair(121).publicKey.toBase58(),
    });
    build.transaction.partialSign(sender);
    const port = mockSyntheticSigner(sender);
    await expect(signSolanaLockTransaction(build, port)).rejects.toThrow(Error);
    expect(port.signTransaction).not.toHaveBeenCalled();
  });

  /**
   * @target signSolanaLockTransaction rejects a wallet-owned signature verifier
   * @dependencies synthetic wallet response with a replaced instance method
   * @scenario return unchanged message bytes, an invalid signature and a verifier claiming success
   * @expected reject the invalid signature using a freshly decoded SDK transaction
   */
  it('rejects a wallet-owned signature verifier', async () => {
    const sender = keypair(113);
    const build = buildSolanaLockMessage(nativeProfile(), {
      asset: 'SOL',
      grossAmount: '1000000',
      destinationAddress: ergoDestination,
      senderAddress: sender.publicKey.toBase58(),
      recentBlockhash: keypair(121).publicKey.toBase58(),
    });
    const port = mockSyntheticSigner(sender);
    port.signTransaction.mockImplementation(async (transaction) => {
      transaction.signatures[0].signature = Buffer.alloc(64, 1);
      transaction.verifySignatures = () => true;
      return transaction;
    });
    await expect(signSolanaLockTransaction(build, port)).rejects.toThrow(
      'Wallet did not authorize the exact lock message',
    );
  });

  /**
   * @target signSolanaLockTransaction validates the wallet's serialized message
   * @dependencies valid synthetic signatures on two independently compiled messages
   * @scenario return an unchanged object whose serializer emits another signed payment
   * @expected reject the decoded wire message despite the original object's matching fields
   */
  it("validates the wallet's serialized message", async () => {
    const sender = keypair(113);
    const request = {
      asset: 'SOL',
      grossAmount: '1000000',
      destinationAddress: ergoDestination,
      senderAddress: sender.publicKey.toBase58(),
      recentBlockhash: keypair(121).publicKey.toBase58(),
    };
    const build = buildSolanaLockMessage(nativeProfile(), request);
    const altered = buildSolanaLockMessage(nativeProfile(), { ...request, grossAmount: '1000001' });
    altered.transaction.partialSign(sender);
    const port = mockSyntheticSigner(sender);
    port.signTransaction.mockImplementation(async (transaction) => {
      transaction.partialSign(sender);
      transaction.serialize = () => altered.transaction.serialize();
      return transaction;
    });
    await expect(signSolanaLockTransaction(build, port)).rejects.toThrow(
      'Wallet changed the lock message while signing',
    );
  });

  /**
   * @target signSolanaLockTransaction detaches the verified result from the wallet
   * @dependencies synthetic wallet retaining its returned transaction
   * @scenario sign, then mutate the wallet-owned signature and payment after the signer returns
   * @expected retain an independently owned result with the exact message and valid signature
   */
  it('detaches the verified result from the wallet', async () => {
    const sender = keypair(113);
    const build = buildSolanaLockMessage(nativeProfile(), {
      asset: 'SOL',
      grossAmount: '1000000',
      destinationAddress: ergoDestination,
      senderAddress: sender.publicKey.toBase58(),
      recentBlockhash: keypair(121).publicKey.toBase58(),
    });
    const port = mockSyntheticSigner(sender);
    let walletResponse: Transaction | undefined;
    port.signTransaction.mockImplementation(async (transaction) => {
      transaction.partialSign(sender);
      walletResponse = transaction;
      return transaction;
    });
    const signed = await signSolanaLockTransaction(build, port);
    expect(walletResponse).toBeDefined();
    expect(signed).not.toBe(walletResponse);
    walletResponse!.signatures[0].signature!.fill(0);
    walletResponse!.instructions[0].data[4] ^= 1;
    expect(signed.verifySignatures()).toEqual(true);
    expect(hasCapturedSolanaLockMessage(build, signed)).toEqual(true);
  });

  /**
   * @target signSolanaLockTransaction rejects %s wallet wire bytes
   * @dependencies wallet serializer returning one independently malformed carrier
   * @scenario return non-byte, oversized or truncated wire data
   * @expected reject before any signature or message can authorize the response
   */
  it.each([
    ['non-byte', 'not-wire-bytes'],
    ['oversized', Buffer.alloc(1233)],
    ['truncated', Buffer.alloc(1)],
  ])('rejects %s wallet wire bytes', async (_label, bytes) => {
    const sender = keypair(113);
    const build = buildSolanaLockMessage(nativeProfile(), {
      asset: 'SOL',
      grossAmount: '1000000',
      destinationAddress: ergoDestination,
      senderAddress: sender.publicKey.toBase58(),
      recentBlockhash: keypair(121).publicKey.toBase58(),
    });
    const port = mockSyntheticSigner(sender);
    port.signTransaction.mockImplementation(async (transaction) => {
      transaction.serialize = (() => bytes) as unknown as Transaction['serialize'];
      return transaction;
    });
    await expect(signSolanaLockTransaction(build, port)).rejects.toThrow(Error);
  });
});
