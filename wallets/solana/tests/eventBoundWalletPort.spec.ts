import { describe, expect, it } from 'vitest';

import { createEventBoundSolanaWalletPort } from '../src/eventBoundWalletPort';
import { signSolanaLockTransaction } from '../src/signerPort';
import { buildEventWalletLock } from './eventBoundWalletPortTestUtils';
import { mockEventSolanaProvider } from './mocked/eventBoundWalletPort.mock';
import { keypair } from './testUtils';

describe('createEventBoundSolanaWalletPort', () => {
  describe('isAvailable', () => {
    /**
     * @target isAvailable should require an event subscription method
     * @dependencies synthetic event provider
     * @scenario retain signing and removal capabilities but omit on
     * @expected event-capable adapter unavailable
     */
    it('should require an event subscription method', () => {
      const { provider } = mockEventSolanaProvider(keypair(1));
      const port = createEventBoundSolanaWalletPort(() => ({ ...provider, on: undefined }));
      expect(port.isAvailable()).toEqual(false);
    });

    /**
     * @target isAvailable should require removable event subscriptions
     * @dependencies synthetic event provider
     * @scenario retain signing and on but omit off
     * @expected unavailable without registering unremovable handlers
     */
    it('should require removable event subscriptions', () => {
      const { provider } = mockEventSolanaProvider(keypair(1));
      const port = createEventBoundSolanaWalletPort(() => ({ ...provider, off: undefined }));
      expect(port.isAvailable()).toEqual(false);
      expect(provider.on).not.toHaveBeenCalled();
    });
  });

  describe('connect', () => {
    /**
     * @target connect should reject synchronous events while installing handlers
     * @dependencies synthetic event provider
     * @scenario first on installs its handler and immediately emits accountChanged
     * @expected refuse before provider.connect and remove both owned handlers
     */
    it('should reject synchronous events while installing handlers', async () => {
      const fixture = mockEventSolanaProvider(keypair(1));
      const subscribe = fixture.provider.on.getMockImplementation();
      fixture.provider.on.mockImplementationOnce((event, listener) => {
        subscribe?.(event, listener);
        fixture.emit(event);
      });
      const port = createEventBoundSolanaWalletPort(() => fixture.provider);
      await expect(port.connect()).rejects.toThrow('changed during connection');
      expect(fixture.provider.connect).not.toHaveBeenCalled();
      expect(fixture.listenerCount()).toEqual(0);
      expect(port.getPublicKey()).toEqual(null);
    });

    /**
     * @target connect should retain primary and cleanup error identities
     * @dependencies synthetic event provider
     * @scenario subscription fails and its first cleanup removal also fails
     * @expected outer aggregate retains primary error and nested removal error
     */
    it('should retain primary and cleanup error identities', async () => {
      const fixture = mockEventSolanaProvider(keypair(1));
      const primary = new Error('Subscription rejected');
      const cleanup = new Error('Removal rejected');
      fixture.provider.on.mockImplementationOnce(() => {
        throw primary;
      });
      fixture.provider.off.mockImplementationOnce(() => {
        throw cleanup;
      });
      const port = createEventBoundSolanaWalletPort(() => fixture.provider);
      let thrown: unknown;
      try {
        await port.connect();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(AggregateError);
      const aggregate = thrown as AggregateError;
      expect(aggregate.errors[0]).toBe(primary);
      expect(aggregate.errors[1]).toBeInstanceOf(AggregateError);
      expect((aggregate.errors[1] as AggregateError).errors[0]).toBe(cleanup);
      expect(fixture.provider.off.mock.calls.map(([event]) => event)).toEqual([
        'accountChanged',
        'disconnect',
      ]);
      expect(fixture.provider.connect).not.toHaveBeenCalled();
      expect(port.getPublicKey()).toEqual(null);
    });

    /**
     * @target connect should remove partial subscriptions after setup fails
     * @dependencies synthetic event provider
     * @scenario second subscription throws after the first was installed
     * @expected both removal attempts, no account and no provider connect call
     */
    it('should remove partial subscriptions after setup fails', async () => {
      const fixture = mockEventSolanaProvider(keypair(1));
      const failure = new Error('Subscription rejected');
      fixture.provider.on.mockImplementationOnce((event, listener) => {
        fixture.provider.on.getMockImplementation()?.(event, listener);
      });
      fixture.provider.on.mockImplementationOnce(() => {
        throw failure;
      });
      const port = createEventBoundSolanaWalletPort(() => fixture.provider);
      await expect(port.connect()).rejects.toBe(failure);
      expect(fixture.provider.off.mock.calls.map(([event]) => event)).toEqual([
        'accountChanged',
        'disconnect',
      ]);
      expect(port.getPublicKey()).toEqual(null);
      expect(fixture.listenerCount()).toEqual(0);
      expect(fixture.provider.connect).not.toHaveBeenCalled();
    });

    /**
     * @target connect should reject an event during the connection await
     * @dependencies synthetic event provider
     * @scenario emit disconnect then return the same connected provider and key
     * @expected event epoch alone rejects the connection and removes handlers
     */
    it('should reject an event during the connection await', async () => {
      const fixture = mockEventSolanaProvider(keypair(1));
      const port = createEventBoundSolanaWalletPort(() => fixture.provider);
      fixture.provider.connect.mockImplementationOnce(async () => {
        fixture.emit('disconnect');
        fixture.provider.isConnected = true;
        return { publicKey: fixture.provider.publicKey };
      });
      await expect(port.connect()).rejects.toThrow('changed during connection');
      expect(port.getPublicKey()).toEqual(null);
      expect(fixture.listenerCount()).toEqual(0);
    });

    /**
     * @target connect should preserve a newer connection when an older request resumes
     * @dependencies synthetic event provider
     * @scenario complete a nested connection on the same provider before returning
     * @expected older epoch rejects without retiring the newer registration
     */
    it('should preserve a newer connection when an older request resumes', async () => {
      const fixture = mockEventSolanaProvider(keypair(1));
      const port = createEventBoundSolanaWalletPort(() => fixture.provider);
      fixture.provider.connect.mockImplementationOnce(async () => {
        await port.connect();
        return { publicKey: fixture.provider.publicKey };
      });
      await expect(port.connect()).rejects.toThrow('changed during connection');
      expect(port.getPublicKey()).toEqual(fixture.provider.publicKey.toBase58());
      expect(fixture.listenerCount()).toEqual(2);
      port.dispose();
    });
  });

  describe('getPublicKey', () => {
    /**
     * @target getPublicKey should require explicit reconnection after an account event
     * @dependencies synthetic event provider
     * @scenario emit accountChanged with the same key still exposed
     * @expected local authority absent until an explicit new connection
     */
    it('should require explicit reconnection after an account event', async () => {
      const fixture = mockEventSolanaProvider(keypair(1));
      const port = createEventBoundSolanaWalletPort(() => fixture.provider);
      await port.connect();
      fixture.emit('accountChanged');
      expect(port.getPublicKey()).toEqual(null);
      expect(fixture.provider.disconnect).not.toHaveBeenCalled();
      await port.connect();
      expect(port.getPublicKey()).toEqual(fixture.provider.publicKey.toBase58());
      expect(fixture.listenerCount()).toEqual(2);
      port.dispose();
    });

    /**
     * @target getPublicKey should ignore callbacks from a retired registration
     * @dependencies synthetic event provider
     * @scenario retain an old callback then reconnect and invoke that callback
     * @expected the new account remains connected with only two live handlers
     */
    it('should ignore callbacks from a retired registration', async () => {
      const fixture = mockEventSolanaProvider(keypair(1));
      const port = createEventBoundSolanaWalletPort(() => fixture.provider);
      await port.connect();
      const retiredCallback = fixture.provider.on.mock.calls[0][1];
      await port.connect();
      retiredCallback();
      expect(port.getPublicKey()).toEqual(fixture.provider.publicKey.toBase58());
      expect(fixture.listenerCount()).toEqual(2);
      port.dispose();
    });
  });

  describe('signTransaction', () => {
    /**
     * @target signTransaction should compose observed state with a verified SOL signature
     * @dependencies SDK, captured builder and synthetic provider
     * @scenario connect and sign the actual native lock through the final signer
     * @expected valid detached transaction with unchanged message and two handlers
     */
    it('should compose observed state with a verified SOL signature', async () => {
      const signer = keypair(1);
      const fixture = mockEventSolanaProvider(signer);
      const port = createEventBoundSolanaWalletPort(() => fixture.provider);
      await port.connect();
      const build = buildEventWalletLock(signer);
      const signed = await signSolanaLockTransaction(build, port);
      expect(signed.verifySignatures()).toEqual(true);
      expect(signed.serializeMessage()).toEqual(build.transaction.serializeMessage());
      expect(fixture.listenerCount()).toEqual(2);
      port.dispose();
    });

    /**
     * @target signTransaction should compose observed state with a verified SPL signature
     * @dependencies SDK, captured builder and synthetic provider
     * @scenario connect and sign the actual original-SPL lock through the final signer
     * @expected valid detached TransferChecked transaction and unchanged message
     */
    it('should compose observed state with a verified SPL signature', async () => {
      const signer = keypair(1);
      const fixture = mockEventSolanaProvider(signer);
      const port = createEventBoundSolanaWalletPort(() => fixture.provider);
      await port.connect();
      const build = buildEventWalletLock(signer, true);
      const signed = await signSolanaLockTransaction(build, port);
      expect(signed.verifySignatures()).toEqual(true);
      expect(signed.serializeMessage()).toEqual(build.transaction.serializeMessage());
      port.dispose();
    });

    /**
     * @target signTransaction should reject an account round trip during signing
     * @dependencies SDK and synthetic event provider
     * @scenario sign correctly, emit A to B to A, then return the original key and wire
     * @expected only event continuity refuses the otherwise valid signature
     */
    it('should reject an account round trip during signing', async () => {
      const signer = keypair(1);
      const fixture = mockEventSolanaProvider(signer);
      const port = createEventBoundSolanaWalletPort(() => fixture.provider);
      await port.connect();
      fixture.provider.signTransaction.mockImplementationOnce(async (transaction) => {
        transaction.partialSign(signer);
        expect(transaction.verifySignatures()).toEqual(true);
        fixture.provider.publicKey = keypair(2).publicKey;
        fixture.emit('accountChanged');
        fixture.provider.publicKey = signer.publicKey;
        fixture.emit('accountChanged');
        return transaction;
      });
      await expect(signSolanaLockTransaction(buildEventWalletLock(signer), port)).rejects.toThrow(
        'changed during signing',
      );
      expect(fixture.provider.publicKey.toBase58()).toEqual(signer.publicKey.toBase58());
      expect(port.getPublicKey()).toEqual(null);
      port.dispose();
    });

    /**
     * @target signTransaction should reject a disconnect and reconnect during signing
     * @dependencies SDK and synthetic event provider
     * @scenario restore provider connection and key after emitting disconnect
     * @expected observed event refuses the otherwise valid signed message
     */
    it('should reject a disconnect and reconnect during signing', async () => {
      const signer = keypair(1);
      const fixture = mockEventSolanaProvider(signer);
      const port = createEventBoundSolanaWalletPort(() => fixture.provider);
      await port.connect();
      fixture.provider.signTransaction.mockImplementationOnce(async (transaction) => {
        transaction.partialSign(signer);
        expect(transaction.verifySignatures()).toEqual(true);
        fixture.provider.isConnected = false;
        fixture.emit('disconnect');
        fixture.provider.isConnected = true;
        return transaction;
      });
      await expect(signSolanaLockTransaction(buildEventWalletLock(signer), port)).rejects.toThrow(
        'changed during signing',
      );
      expect(fixture.provider.isConnected).toEqual(true);
      expect(port.getPublicKey()).toEqual(null);
      port.dispose();
    });
  });

  describe('disconnect', () => {
    /**
     * @target disconnect should retire local authority before cleanup failure
     * @dependencies synthetic event provider
     * @scenario first off observes the local account absent then throws
     * @expected both removal attempts and no provider disconnect after cleanup failure
     */
    it('should retire local authority before cleanup failure', async () => {
      const fixture = mockEventSolanaProvider(keypair(1));
      const port = createEventBoundSolanaWalletPort(() => fixture.provider);
      await port.connect();
      fixture.provider.off.mockImplementationOnce(() => {
        expect(port.getPublicKey()).toEqual(null);
        throw new Error('Removal rejected');
      });
      await expect(port.disconnect()).rejects.toThrow('cleanup failed');
      expect(fixture.provider.off.mock.calls.map(([event]) => event)).toEqual([
        'accountChanged',
        'disconnect',
      ]);
      expect(port.isAvailable()).toEqual(true);
      expect(port.getPublicKey()).toEqual(null);
      expect(fixture.provider.disconnect).not.toHaveBeenCalled();
    });

    /**
     * @target disconnect should remove owned handlers and clear the connected account
     * @dependencies synthetic event provider
     * @scenario explicitly disconnect a connected adapter
     * @expected provider disconnect called once, no live handlers or local account
     */
    it('should remove owned handlers and clear the connected account', async () => {
      const fixture = mockEventSolanaProvider(keypair(1));
      const port = createEventBoundSolanaWalletPort(() => fixture.provider);
      await port.connect();
      await port.disconnect();
      expect(fixture.provider.disconnect).toHaveBeenCalledTimes(1);
      expect(fixture.listenerCount()).toEqual(0);
      expect(port.getPublicKey()).toEqual(null);
    });

    /**
     * @target disconnect should clear local authority when the provider rejects
     * @dependencies synthetic event provider
     * @scenario provider disconnection rejects with its original error
     * @expected error identity preserved and local account/handlers absent
     */
    it('should clear local authority when the provider rejects', async () => {
      const fixture = mockEventSolanaProvider(keypair(1));
      const failure = new Error('Disconnect rejected');
      const port = createEventBoundSolanaWalletPort(() => fixture.provider);
      await port.connect();
      fixture.provider.disconnect.mockRejectedValueOnce(failure);
      await expect(port.disconnect()).rejects.toBe(failure);
      expect(fixture.provider.isConnected).toEqual(true);
      expect(port.getPublicKey()).toEqual(null);
      expect(fixture.listenerCount()).toEqual(0);
    });
  });

  describe('dispose', () => {
    /**
     * @target dispose should retire the adapter without disconnecting the provider
     * @dependencies synthetic event provider
     * @scenario dispose twice and attempt reconnection
     * @expected idempotent retirement, unavailable adapter and no provider disconnect
     */
    it('should retire the adapter without disconnecting the provider', async () => {
      const fixture = mockEventSolanaProvider(keypair(1));
      const port = createEventBoundSolanaWalletPort(() => fixture.provider);
      await port.connect();
      port.dispose();
      port.dispose();
      expect(port.isAvailable()).toEqual(false);
      expect(port.getPublicKey()).toEqual(null);
      expect(fixture.listenerCount()).toEqual(0);
      expect(fixture.provider.disconnect).not.toHaveBeenCalled();
      await expect(port.connect()).rejects.toThrow('disposed');
    });

    /**
     * @target dispose should invalidate a pending signed response
     * @dependencies SDK and synthetic event provider
     * @scenario sign correctly then dispose before returning the unchanged transaction
     * @expected local retirement refuses the valid signed response
     */
    it('should invalidate a pending signed response', async () => {
      const signer = keypair(1);
      const fixture = mockEventSolanaProvider(signer);
      const port = createEventBoundSolanaWalletPort(() => fixture.provider);
      await port.connect();
      fixture.provider.signTransaction.mockImplementationOnce(async (transaction) => {
        transaction.partialSign(signer);
        expect(transaction.verifySignatures()).toEqual(true);
        port.dispose();
        return transaction;
      });
      await expect(signSolanaLockTransaction(buildEventWalletLock(signer), port)).rejects.toThrow(
        'changed during signing',
      );
      expect(fixture.listenerCount()).toEqual(0);
    });

    /**
     * @target dispose should attempt both removals even when the first throws
     * @dependencies synthetic event provider
     * @scenario first off throws after connection and a retired callback later fires
     * @expected cleanup failure reported, both off calls and permanently absent authority
     */
    it('should attempt both removals even when the first throws', async () => {
      const fixture = mockEventSolanaProvider(keypair(1));
      const port = createEventBoundSolanaWalletPort(() => fixture.provider);
      await port.connect();
      const callback = fixture.provider.on.mock.calls[0][1];
      fixture.provider.off.mockImplementationOnce(() => {
        throw new Error('Removal rejected');
      });
      expect(() => port.dispose()).toThrow('cleanup failed');
      callback();
      expect(fixture.provider.off.mock.calls.map(([event]) => event)).toEqual([
        'accountChanged',
        'disconnect',
      ]);
      expect(port.isAvailable()).toEqual(false);
      expect(port.getPublicKey()).toEqual(null);
    });
  });
});
