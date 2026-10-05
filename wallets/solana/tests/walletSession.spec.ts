import { describe, expect, it } from 'vitest';

import {
  createEventBoundSolanaWalletPort,
  isCurrentSolanaWalletSession,
} from '../src/eventBoundWalletPort';
import { mockEventSolanaProvider } from './mocked/eventBoundWalletPort.mock';
import {
  emitDuringNextWalletKeyRead,
  throwDuringNextWalletKeyRead,
} from './mocked/walletSession.mock';
import { keypair } from './testUtils';

describe('createEventBoundSolanaWalletPort', () => {
  describe('getPublicKey', () => {
    /**
     * @target getPublicKey should preserve an external read error while revoking authority
     * @dependencies connected wallet and one exact injected key-read error
     * @scenario throw during decoding, then let the same key decode normally
     * @expected the original error is reported and the prior session cannot revive
     */
    it('should preserve an external read error while revoking authority', async () => {
      const fixture = mockEventSolanaProvider(keypair(1));
      const port = createEventBoundSolanaWalletPort(() => fixture.provider);
      await port.connect();
      const session = port.captureSession();
      const error = new Error('Account read rejected');
      throwDuringNextWalletKeyRead(fixture, error);
      let caught: unknown;
      try {
        port.getPublicKey();
      } catch (failure) {
        caught = failure;
      }
      expect(caught).toBe(error);
      expect(port.getPublicKey()).toEqual(null);
      expect(isCurrentSolanaWalletSession(session)).toEqual(false);
    });

    /**
     * @target getPublicKey should require explicit reconnection after an observed account change
     * @dependencies connected event provider with canonical keys A and B
     * @scenario observe B without an event, then restore A
     * @expected neither account read restores authority until an explicit connect
     */
    it('should require explicit reconnection after an observed account change', async () => {
      const fixture = mockEventSolanaProvider(keypair(1));
      const port = createEventBoundSolanaWalletPort(() => fixture.provider);
      await port.connect();
      const original = fixture.provider.publicKey;
      fixture.provider.publicKey = keypair(2).publicKey;
      expect(port.getPublicKey()).toEqual(null);
      expect(() => port.captureSession()).toThrow('disconnected');
      fixture.provider.publicKey = original;
      expect(port.getPublicKey()).toEqual(null);
      expect(await port.connect()).toEqual(original.toBase58());
      expect(port.getPublicKey()).toEqual(original.toBase58());
    });

    /**
     * @target getPublicKey should reject invalidation during synchronous key decoding
     * @dependencies event provider with one deferred key-read event
     * @scenario connect normally, then emit accountChanged from the next toBase58
     * @expected the current read returns null, with no further provider connection
     */
    it('should reject invalidation during synchronous key decoding', async () => {
      const fixture = mockEventSolanaProvider(keypair(1));
      const port = createEventBoundSolanaWalletPort(() => fixture.provider);
      await port.connect();
      emitDuringNextWalletKeyRead(fixture);
      expect(port.getPublicKey()).toEqual(null);
      expect(fixture.provider.connect).toHaveBeenCalledTimes(1);
      expect(port.getPublicKey()).toEqual(null);
    });
  });

  describe('captureSession', () => {
    /**
     * @target captureSession should require a connected account
     * @dependencies available event provider with no explicit connection
     * @scenario capture without connecting
     * @expected capture throws and provider remains unconnected
     */
    it('should require a connected account', () => {
      const fixture = mockEventSolanaProvider(keypair(1));
      const port = createEventBoundSolanaWalletPort(() => fixture.provider);
      expect(() => port.captureSession()).toThrow('disconnected');
      expect(fixture.provider.connect).not.toHaveBeenCalled();
    });

    /**
     * @target captureSession should preserve one immutable account identity
     * @dependencies actual event port and deterministic wallet key
     * @scenario explicitly connect and capture the live session
     * @expected immutable canonical account, current session and no extra connection
     */
    it('should preserve one immutable account identity', async () => {
      const fixture = mockEventSolanaProvider(keypair(1));
      const port = createEventBoundSolanaWalletPort(() => fixture.provider);
      const key = await port.connect();
      const session = port.captureSession();
      expect(session.publicKey).toEqual(key);
      expect(Object.isFrozen(session)).toEqual(true);
      expect(isCurrentSolanaWalletSession(session)).toEqual(true);
      expect(fixture.provider.connect).toHaveBeenCalledTimes(1);
    });

    /**
     * @target captureSession should reject events during its account read
     * @dependencies event provider with a key-read event
     * @scenario emit accountChanged during capture after a successful connect
     * @expected no session is issued for the invalidated authority
     */
    it('should reject events during its account read', async () => {
      const fixture = mockEventSolanaProvider(keypair(1));
      const port = createEventBoundSolanaWalletPort(() => fixture.provider);
      await port.connect();
      emitDuringNextWalletKeyRead(fixture);
      expect(() => port.captureSession()).toThrow('disconnected');
    });
  });

  describe('isCurrentSolanaWalletSession', () => {
    /**
     * @target isCurrentSolanaWalletSession should reject forged or copied identities
     * @dependencies one valid captured session
     * @scenario test a copied record and values without local provenance
     * @expected only the original live capture passes
     */
    it('should reject forged or copied identities', async () => {
      const fixture = mockEventSolanaProvider(keypair(1));
      const port = createEventBoundSolanaWalletPort(() => fixture.provider);
      await port.connect();
      const session = port.captureSession();
      for (const value of [undefined, null, 0, '', {}, { ...session }])
        expect(isCurrentSolanaWalletSession(value)).toEqual(false);
      expect(isCurrentSolanaWalletSession(session)).toEqual(true);
    });

    /**
     * @target isCurrentSolanaWalletSession should revoke a capture after account events
     * @dependencies one connected event provider
     * @scenario emit accountChanged while the same key remains visible
     * @expected old capture remains invalid after explicit reconnection, new capture passes
     */
    it('should revoke a capture after account events', async () => {
      const fixture = mockEventSolanaProvider(keypair(1));
      const port = createEventBoundSolanaWalletPort(() => fixture.provider);
      await port.connect();
      const old = port.captureSession();
      fixture.emit('accountChanged');
      expect(isCurrentSolanaWalletSession(old)).toEqual(false);
      await port.connect();
      expect(isCurrentSolanaWalletSession(old)).toEqual(false);
      expect(isCurrentSolanaWalletSession(port.captureSession())).toEqual(true);
    });

    /**
     * @target isCurrentSolanaWalletSession should revoke every retired connection
     * @dependencies independent connected event ports
     * @scenario emit disconnect, explicitly disconnect, reconnect or dispose
     * @expected each prior capture refuses without requesting a new connection
     */
    it('should revoke every retired connection', async () => {
      for (const action of ['event', 'disconnect', 'reconnect', 'dispose'] as const) {
        const fixture = mockEventSolanaProvider(keypair(1));
        const port = createEventBoundSolanaWalletPort(() => fixture.provider);
        await port.connect();
        const session = port.captureSession();
        if (action === 'event') fixture.emit('disconnect');
        if (action === 'disconnect') await port.disconnect();
        if (action === 'reconnect') await port.connect();
        if (action === 'dispose') port.dispose();
        expect(isCurrentSolanaWalletSession(session)).toEqual(false);
      }
    });

    /**
     * @target isCurrentSolanaWalletSession should revoke a replaced provider until reconnect
     * @dependencies one captured provider and a mutable discovery callback
     * @scenario replace the discovered provider, then restore the original
     * @expected old capture never revives and a newly connected capture passes
     */
    it('should revoke a replaced provider until reconnect', async () => {
      const fixture = mockEventSolanaProvider(keypair(1));
      let discovery: unknown = fixture.provider;
      const port = createEventBoundSolanaWalletPort(() => discovery);
      await port.connect();
      const session = port.captureSession();
      discovery = mockEventSolanaProvider(keypair(1)).provider;
      expect(isCurrentSolanaWalletSession(session)).toEqual(false);
      discovery = fixture.provider;
      expect(isCurrentSolanaWalletSession(session)).toEqual(false);
      expect(port.getPublicKey()).toEqual(null);
      await port.connect();
      expect(isCurrentSolanaWalletSession(session)).toEqual(false);
      expect(isCurrentSolanaWalletSession(port.captureSession())).toEqual(true);
    });

    /**
     * @target isCurrentSolanaWalletSession should revoke an absent provider until reconnect
     * @dependencies fresh live capture with mutable provider discovery
     * @scenario hide the provider without an event, then restore the original
     * @expected absence alone revokes the old capture and explicit reconnect is required
     */
    it('should revoke an absent provider until reconnect', async () => {
      const fixture = mockEventSolanaProvider(keypair(1));
      let discovery: unknown = fixture.provider;
      const port = createEventBoundSolanaWalletPort(() => discovery);
      await port.connect();
      const session = port.captureSession();
      discovery = undefined;
      expect(isCurrentSolanaWalletSession(session)).toEqual(false);
      discovery = fixture.provider;
      expect(isCurrentSolanaWalletSession(session)).toEqual(false);
      expect(port.getPublicKey()).toEqual(null);
      await port.connect();
      expect(isCurrentSolanaWalletSession(session)).toEqual(false);
      expect(isCurrentSolanaWalletSession(port.captureSession())).toEqual(true);
    });

    /**
     * @target isCurrentSolanaWalletSession should revoke an observed canonical account mismatch
     * @dependencies fresh capture of A and valid alternative account B
     * @scenario validate while B is exposed, then restore A without an event
     * @expected captured A stays invalid and no new session is issued without reconnect
     */
    it('should revoke an observed canonical account mismatch', async () => {
      const fixture = mockEventSolanaProvider(keypair(1));
      const port = createEventBoundSolanaWalletPort(() => fixture.provider);
      await port.connect();
      const session = port.captureSession();
      const original = fixture.provider.publicKey;
      fixture.provider.publicKey = keypair(2).publicKey;
      expect(isCurrentSolanaWalletSession(session)).toEqual(false);
      fixture.provider.publicKey = original;
      expect(isCurrentSolanaWalletSession(session)).toEqual(false);
      expect(() => port.captureSession()).toThrow('disconnected');
      await port.connect();
      expect(isCurrentSolanaWalletSession(session)).toEqual(false);
      expect(isCurrentSolanaWalletSession(port.captureSession())).toEqual(true);
    });

    /**
     * @target isCurrentSolanaWalletSession should reject synchronous invalidation during checking
     * @dependencies one captured session and an account-read event
     * @scenario emit accountChanged from toBase58 while checking the capture
     * @expected the same validation returns false
     */
    it('should reject synchronous invalidation during checking', async () => {
      const fixture = mockEventSolanaProvider(keypair(1));
      const port = createEventBoundSolanaWalletPort(() => fixture.provider);
      await port.connect();
      const session = port.captureSession();
      emitDuringNextWalletKeyRead(fixture);
      expect(isCurrentSolanaWalletSession(session)).toEqual(false);
    });

    /**
     * @target isCurrentSolanaWalletSession should fail closed when account reads throw
     * @dependencies one captured session and a malformed later public key
     * @scenario remove the external public key after capture
     * @expected false rather than an exception or provider connection
     */
    it('should fail closed when account reads throw', async () => {
      const fixture = mockEventSolanaProvider(keypair(1));
      const port = createEventBoundSolanaWalletPort(() => fixture.provider);
      await port.connect();
      const session = port.captureSession();
      const original = fixture.provider.publicKey;
      Object.defineProperty(fixture.provider, 'publicKey', { value: null });
      expect(isCurrentSolanaWalletSession(session)).toEqual(false);
      fixture.provider.publicKey = original;
      expect(isCurrentSolanaWalletSession(session)).toEqual(false);
      expect(fixture.provider.connect).toHaveBeenCalledTimes(1);
    });
  });
});
