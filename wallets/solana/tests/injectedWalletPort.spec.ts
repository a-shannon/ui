import { describe, expect, it } from 'vitest';

import { buildSolanaLockMessage } from '@rosen-network/solana';

import { createLegacySolanaWalletPort } from '../src/injectedWalletPort';
import { signSolanaLockTransaction } from '../src/signerPort';
import { mockInjectedSolanaProvider } from './mocked/injectedWalletPort.mock';
import { ergoDestination, keypair, nativeProfile, splProfile } from './testUtils';

describe('createLegacySolanaWalletPort', () => {
  describe('isAvailable', () => {
    /**
     * @target isAvailable should remain disconnected when the API is absent
     * @dependencies none
     * @scenario inspect an absent provider without connecting
     * @expected unavailable and no public key
     */
    it('should remain disconnected when the API is absent', () => {
      const port = createLegacySolanaWalletPort(() => undefined);
      expect(port.isAvailable()).toEqual(false);
      expect(port.getPublicKey()).toEqual(null);
    });

    /**
     * @target isAvailable should tolerate inaccessible browser discovery
     * @dependencies none
     * @scenario use a discovery function that throws
     * @expected unavailable without a browser global requirement
     */
    it('should tolerate inaccessible browser discovery', () => {
      const port = createLegacySolanaWalletPort(() => {
        throw new ReferenceError('No browser');
      });
      expect(port.isAvailable()).toEqual(false);
      expect(port.getPublicKey()).toEqual(null);
    });

    /**
     * @target isAvailable should refuse a provider without sign-only capability
     * @dependencies mocked legacy API
     * @scenario remove signTransaction while leaving other methods available
     * @expected unavailable without a sign-and-send fallback
     */
    it('should refuse a provider without sign-only capability', () => {
      const provider = mockInjectedSolanaProvider(keypair(1));
      const port = createLegacySolanaWalletPort(() => ({
        ...provider,
        signTransaction: undefined,
      }));
      expect(port.isAvailable()).toEqual(false);
    });
  });

  describe('connect', () => {
    /**
     * @target connect should reject an older request after a newer connection completes
     * @dependencies mocked legacy API
     * @scenario complete a nested connection using the same provider and key
     * @expected epoch change rejects the older request and preserves the newer account
     */
    it('should reject an older request after a newer connection completes', async () => {
      const provider = mockInjectedSolanaProvider(keypair(1));
      const port = createLegacySolanaWalletPort(() => provider);
      provider.connect.mockImplementationOnce(async () => {
        await port.connect();
        return { publicKey: provider.publicKey };
      });
      await expect(port.connect()).rejects.toThrow('changed during connection');
      expect(port.getPublicKey()).toEqual(provider.publicKey.toBase58());
    });

    /**
     * @target connect should reject a malformed reported public key
     * @dependencies mocked legacy API
     * @scenario connect with a key carrier whose encoding is invalid
     * @expected invalid key refused without a captured account
     */
    it('should reject a malformed reported public key', async () => {
      const provider = mockInjectedSolanaProvider(keypair(1));
      // The unknown API response deliberately supplies only its key carrier.
      provider.publicKey = { toBase58: () => 'not-a-public-key' } as typeof provider.publicKey;
      const port = createLegacySolanaWalletPort(() => provider);
      await expect(port.connect()).rejects.toThrow('invalid public key');
      expect(port.getPublicKey()).toEqual(null);
    });

    /**
     * @target connect should reject a returned response without a public key
     * @dependencies mocked legacy API
     * @scenario connect successfully but return an incomplete API response
     * @expected missing key refused without a captured account
     */
    it('should reject a returned response without a public key', async () => {
      const provider = mockInjectedSolanaProvider(keypair(1));
      provider.connect.mockImplementationOnce(async () => {
        provider.isConnected = true;
        // The omitted response field is the isolated runtime fault.
        return {} as { publicKey: typeof provider.publicKey };
      });
      const port = createLegacySolanaWalletPort(() => provider);
      await expect(port.connect()).rejects.toThrow('invalid public key');
      expect(port.getPublicKey()).toEqual(null);
    });

    /**
     * @target connect should capture the provider and canonical account
     * @dependencies mocked legacy API
     * @scenario inspect availability then explicitly connect
     * @expected one connect call and the canonical connected key
     */
    it('should capture the provider and canonical account', async () => {
      const provider = mockInjectedSolanaProvider(keypair(1));
      const port = createLegacySolanaWalletPort(() => provider);
      expect(port.isAvailable()).toEqual(true);
      expect(port.getPublicKey()).toEqual(null);
      expect(provider.connect).not.toHaveBeenCalled();
      await expect(port.connect()).resolves.toEqual(provider.publicKey.toBase58());
      expect(port.getPublicKey()).toEqual(provider.publicKey.toBase58());
      expect(provider.connect).toHaveBeenCalledTimes(1);
    });

    /**
     * @target connect should preserve user refusal and leave the port disconnected
     * @dependencies mocked legacy API
     * @scenario reject connection with an explicit error
     * @expected the original error identity and no captured account
     */
    it('should preserve user refusal and leave the port disconnected', async () => {
      const provider = mockInjectedSolanaProvider(keypair(1));
      const refusal = new Error('User declined');
      provider.connect.mockRejectedValueOnce(refusal);
      const port = createLegacySolanaWalletPort(() => provider);
      await expect(port.connect()).rejects.toBe(refusal);
      expect(port.getPublicKey()).toEqual(null);
    });

    /**
     * @target connect should reject a response for a different account
     * @dependencies mocked legacy API
     * @scenario return another valid public key after connecting
     * @expected no captured account
     */
    it('should reject a response for a different account', async () => {
      const provider = mockInjectedSolanaProvider(keypair(1));
      provider.connect.mockImplementationOnce(async () => {
        provider.isConnected = true;
        return { publicKey: keypair(2).publicKey };
      });
      const port = createLegacySolanaWalletPort(() => provider);
      await expect(port.connect()).rejects.toThrow('different account');
      expect(port.getPublicKey()).toEqual(null);
    });

    /**
     * @target connect should reject a replaced provider during connection
     * @dependencies mocked legacy API
     * @scenario replace discovery with another API while connect is awaited
     * @expected no captured account even when both providers report the same key
     */
    it('should reject a replaced provider during connection', async () => {
      const provider = mockInjectedSolanaProvider(keypair(1));
      let current = provider;
      provider.connect.mockImplementationOnce(async () => {
        provider.isConnected = true;
        current = mockInjectedSolanaProvider(keypair(1));
        return { publicKey: provider.publicKey };
      });
      const port = createLegacySolanaWalletPort(() => current);
      await expect(port.connect()).rejects.toThrow('changed during connection');
      expect(port.getPublicKey()).toEqual(null);
    });
  });

  describe('disconnect', () => {
    /**
     * @target disconnect should invalidate the account when discovery is unavailable
     * @dependencies mocked legacy API
     * @scenario lose discovery before disconnect and restore it after rejection
     * @expected the previous local connection must not reappear
     */
    it('should invalidate the account when discovery is unavailable', async () => {
      const provider = mockInjectedSolanaProvider(keypair(1));
      let current: typeof provider | undefined = provider;
      const port = createLegacySolanaWalletPort(() => current);
      await port.connect();
      current = undefined;
      await expect(port.disconnect()).rejects.toThrow('unavailable');
      current = provider;
      expect(port.getPublicKey()).toEqual(null);
      expect(provider.disconnect).not.toHaveBeenCalled();
    });

    /**
     * @target disconnect should invalidate a previously captured account
     * @dependencies mocked legacy API
     * @scenario connect then disconnect successfully
     * @expected one disconnect call and no public key
     */
    it('should invalidate a previously captured account', async () => {
      const provider = mockInjectedSolanaProvider(keypair(1));
      const port = createLegacySolanaWalletPort(() => provider);
      await port.connect();
      await port.disconnect();
      expect(provider.disconnect).toHaveBeenCalledTimes(1);
      expect(port.getPublicKey()).toEqual(null);
    });

    /**
     * @target disconnect should remain locally disconnected after a provider refusal
     * @dependencies mocked legacy API
     * @scenario refuse the provider disconnection request
     * @expected original error identity and invalidated local account
     */
    it('should remain locally disconnected after a provider refusal', async () => {
      const provider = mockInjectedSolanaProvider(keypair(1));
      const refusal = new Error('Disconnect failed');
      provider.disconnect.mockRejectedValueOnce(refusal);
      const port = createLegacySolanaWalletPort(() => provider);
      await port.connect();
      await expect(port.disconnect()).rejects.toBe(refusal);
      expect(port.getPublicKey()).toEqual(null);
    });
  });

  describe('signTransaction', () => {
    /**
     * @target signTransaction should reject a new connection with the same provider and key
     * @dependencies synthetic legacy API
     * @scenario reconnect during signing then return the originally signed message
     * @expected epoch change alone rejects while the new connection remains usable
     */
    it('should reject a new connection with the same provider and key', async () => {
      const sender = keypair(1);
      const provider = mockInjectedSolanaProvider(sender);
      const port = createLegacySolanaWalletPort(() => provider);
      await port.connect();
      provider.signTransaction.mockImplementationOnce(async (transaction) => {
        transaction.partialSign(sender);
        await port.disconnect();
        await port.connect();
        expect(port.getPublicKey()).toEqual(sender.publicKey.toBase58());
        return transaction;
      });
      const build = buildSolanaLockMessage(nativeProfile(), {
        asset: 'SOL',
        grossAmount: '1000',
        destinationAddress: ergoDestination,
        senderAddress: sender.publicKey.toBase58(),
        recentBlockhash: keypair(3).publicKey.toBase58(),
      });
      await expect(signSolanaLockTransaction(build, port)).rejects.toThrow(
        'changed during signing',
      );
      expect(port.getPublicKey()).toEqual(sender.publicKey.toBase58());
    });

    /**
     * @target signTransaction should compose a native lock with the real signer
     * @dependencies SDK signer and synthetic legacy API
     * @scenario build a native lock and sign through the connected port
     * @expected valid signature, exact message and independent return object
     */
    it('should compose a native lock with the real signer', async () => {
      const sender = keypair(1);
      const provider = mockInjectedSolanaProvider(sender);
      const port = createLegacySolanaWalletPort(() => provider);
      await port.connect();
      const build = buildSolanaLockMessage(nativeProfile(), {
        asset: 'SOL',
        grossAmount: '1000',
        destinationAddress: ergoDestination,
        senderAddress: sender.publicKey.toBase58(),
        recentBlockhash: keypair(3).publicKey.toBase58(),
      });
      const signed = await signSolanaLockTransaction(build, port);
      expect(signed.verifySignatures()).toEqual(true);
      expect(signed.serializeMessage()).toEqual(build.transaction.serializeMessage());
      expect(signed).not.toBe(build.transaction);
      expect(provider.signTransaction).toHaveBeenCalledTimes(1);
    });

    /**
     * @target signTransaction should compose an original SPL lock with the real signer
     * @dependencies SDK signer and synthetic legacy API
     * @scenario build TransferChecked for a captured mint and account
     * @expected valid signature and exact message
     */
    it('should compose an original SPL lock with the real signer', async () => {
      const sender = keypair(1);
      const provider = mockInjectedSolanaProvider(sender);
      const port = createLegacySolanaWalletPort(() => provider);
      await port.connect();
      const mint = keypair(9).publicKey.toBase58();
      const build = buildSolanaLockMessage(splProfile(mint, keypair(10).publicKey.toBase58()), {
        asset: mint,
        grossAmount: '1000',
        destinationAddress: ergoDestination,
        senderAddress: sender.publicKey.toBase58(),
        recentBlockhash: keypair(3).publicKey.toBase58(),
        sourceTokenAccount: keypair(11).publicKey.toBase58(),
      });
      const signed = await signSolanaLockTransaction(build, port);
      expect(signed.verifySignatures()).toEqual(true);
      expect(signed.serializeMessage()).toEqual(build.transaction.serializeMessage());
    });

    /**
     * @target signTransaction should reject a disconnected port before signing
     * @dependencies synthetic legacy API
     * @scenario submit a lock before explicitly connecting
     * @expected no provider sign call
     */
    it('should reject a disconnected port before signing', async () => {
      const sender = keypair(1);
      const provider = mockInjectedSolanaProvider(sender);
      const port = createLegacySolanaWalletPort(() => provider);
      const build = buildSolanaLockMessage(nativeProfile(), {
        asset: 'SOL',
        grossAmount: '1000',
        destinationAddress: ergoDestination,
        senderAddress: sender.publicKey.toBase58(),
        recentBlockhash: keypair(3).publicKey.toBase58(),
      });
      await expect(signSolanaLockTransaction(build, port)).rejects.toThrow('disconnected');
      expect(provider.signTransaction).not.toHaveBeenCalled();
    });

    /**
     * @target signTransaction should reject a replaced provider during signing
     * @dependencies synthetic legacy API
     * @scenario return a valid signature after replacing discovery with the same key
     * @expected signing rejected despite cryptographically valid returned bytes
     */
    it('should reject a replaced provider during signing', async () => {
      const sender = keypair(1);
      const provider = mockInjectedSolanaProvider(sender);
      let current = provider;
      const port = createLegacySolanaWalletPort(() => current);
      await port.connect();
      provider.signTransaction.mockImplementationOnce(async (transaction) => {
        transaction.partialSign(sender);
        current = mockInjectedSolanaProvider(sender);
        current.isConnected = true;
        return transaction;
      });
      const build = buildSolanaLockMessage(nativeProfile(), {
        asset: 'SOL',
        grossAmount: '1000',
        destinationAddress: ergoDestination,
        senderAddress: sender.publicKey.toBase58(),
        recentBlockhash: keypair(3).publicKey.toBase58(),
      });
      await expect(signSolanaLockTransaction(build, port)).rejects.toThrow(
        'changed during signing',
      );
    });

    /**
     * @target signTransaction should reject an account change during signing
     * @dependencies synthetic legacy API
     * @scenario sign the expected message but expose another account afterwards
     * @expected signing rejected
     */
    it('should reject an account change during signing', async () => {
      const sender = keypair(1);
      const provider = mockInjectedSolanaProvider(sender);
      const port = createLegacySolanaWalletPort(() => provider);
      await port.connect();
      provider.signTransaction.mockImplementationOnce(async (transaction) => {
        transaction.partialSign(sender);
        provider.publicKey = keypair(2).publicKey;
        return transaction;
      });
      const build = buildSolanaLockMessage(nativeProfile(), {
        asset: 'SOL',
        grossAmount: '1000',
        destinationAddress: ergoDestination,
        senderAddress: sender.publicKey.toBase58(),
        recentBlockhash: keypair(3).publicKey.toBase58(),
      });
      await expect(signSolanaLockTransaction(build, port)).rejects.toThrow(
        'changed during signing',
      );
    });

    /**
     * @target signTransaction should reject disconnection during signing
     * @dependencies synthetic legacy API
     * @scenario disconnect through the adapter before returning a valid signature
     * @expected pending signing rejected and no captured account
     */
    it('should reject disconnection during signing', async () => {
      const sender = keypair(1);
      const provider = mockInjectedSolanaProvider(sender);
      const port = createLegacySolanaWalletPort(() => provider);
      await port.connect();
      provider.signTransaction.mockImplementationOnce(async (transaction) => {
        transaction.partialSign(sender);
        await port.disconnect();
        return transaction;
      });
      const build = buildSolanaLockMessage(nativeProfile(), {
        asset: 'SOL',
        grossAmount: '1000',
        destinationAddress: ergoDestination,
        senderAddress: sender.publicKey.toBase58(),
        recentBlockhash: keypair(3).publicKey.toBase58(),
      });
      await expect(signSolanaLockTransaction(build, port)).rejects.toThrow(
        'changed during signing',
      );
      expect(port.getPublicKey()).toEqual(null);
    });
  });
});
