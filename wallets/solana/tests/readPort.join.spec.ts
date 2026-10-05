import { describe, expect, it } from 'vitest';

import { createEventBoundSolanaWalletPort } from '../src/eventBoundWalletPort';
import {
  isCurrentSolanaWalletBalanceView,
  readSolanaWalletBalance,
  selectSolanaSourceTokenAccount,
} from '../src/readPort';
import { mockEventSolanaProvider } from './mocked/eventBoundWalletPort.mock';
import {
  createReadPortProfile,
  createReadPortResult,
  deferredReadPortResult,
} from './readPortTestUtils';
import { keypair } from './testUtils';

describe('readSolanaWalletBalance', () => {
  /**
   * @target readSolanaWalletBalance joins an actual captured wallet session to raw SOL and SPL reads
   * @dependencies actual event-bound port and profile capture; synthetic provider and read service
   * @scenario connect, capture a session, read and select the explicit original-SPL account
   * @expected exact owned inventory and locally current captured view
   */
  it('joins an actual captured wallet session to raw SOL and SPL reads', async () => {
    const fixture = mockEventSolanaProvider(keypair(1));
    const port = createEventBoundSolanaWalletPort(() => fixture.provider);
    await port.connect();
    const result = createReadPortResult();
    const view = await readSolanaWalletBalance(
      createReadPortProfile(),
      port.captureSession(),
      async () => result,
    );
    expect(view.publicKey).toEqual(keypair(1).publicKey.toBase58());
    expect(view.nativeBalance).toEqual(result.nativeBalance);
    expect(
      selectSolanaSourceTokenAccount(
        view,
        result.tokenAccounts[0].mint,
        result.tokenAccounts[0].address,
      ).amount,
    ).toEqual(result.tokenAccounts[0].amount);
    expect(isCurrentSolanaWalletBalanceView(view)).toEqual(true);
    port.dispose();
    expect(isCurrentSolanaWalletBalanceView(view)).toEqual(false);
  });

  /**
   * @target readSolanaWalletBalance rejects an account A to B to A transition during a pending read
   * @dependencies actual event-bound port and profile capture; synthetic provider and deferred read service
   * @scenario change and restore public key with accountChanged events before service completion
   * @expected old captured session cannot yield a balance view despite restored public key
   */
  it('rejects an account A to B to A transition during a pending read', async () => {
    const fixture = mockEventSolanaProvider(keypair(1));
    const port = createEventBoundSolanaWalletPort(() => fixture.provider);
    await port.connect();
    const deferred = deferredReadPortResult();
    const pending = readSolanaWalletBalance(
      createReadPortProfile(),
      port.captureSession(),
      () => deferred.promise,
    );
    fixture.provider.publicKey = keypair(2).publicKey;
    fixture.emit('accountChanged');
    fixture.provider.publicKey = keypair(1).publicKey;
    fixture.emit('accountChanged');
    deferred.resolve(createReadPortResult());
    await expect(pending).rejects.toThrow('stale');
    port.dispose();
  });

  /**
   * @target readSolanaWalletBalance rejects lifecycle change %s during a pending read
   * @dependencies actual event-bound port and profile capture; synthetic provider and deferred read service
   * @scenario disconnect, dispose, replace provider or reconnect before completing old read
   * @expected old session refused independently of account string equality
   */
  it.each(['disconnect', 'dispose', 'provider replacement', 'reconnect'] as const)(
    'rejects lifecycle change %s during a pending read',
    async (change) => {
      const fixture = mockEventSolanaProvider(keypair(1));
      let provider = fixture.provider;
      const port = createEventBoundSolanaWalletPort(() => provider);
      await port.connect();
      const deferred = deferredReadPortResult();
      const pending = readSolanaWalletBalance(
        createReadPortProfile(),
        port.captureSession(),
        () => deferred.promise,
      );
      if (change === 'disconnect') await port.disconnect();
      if (change === 'dispose') port.dispose();
      if (change === 'provider replacement')
        provider = mockEventSolanaProvider(keypair(1)).provider;
      if (change === 'reconnect') await port.connect();
      deferred.resolve(createReadPortResult());
      await expect(pending).rejects.toThrow('stale');
      port.dispose();
    },
  );
});
