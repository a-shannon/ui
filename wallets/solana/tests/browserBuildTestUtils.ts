import { Transaction } from '@solana/web3.js';
import * as ergo from 'ergo-lib-wasm-nodejs';

import {
  buildSolanaLockMessage,
  captureSolanaLockProfile,
  hasCapturedSolanaLockMessage,
  isCapturedSolanaLockProfile,
  type SolanaLockAssetPolicy,
  validateSolanaLockTarget,
} from '@rosen-network/solana';

import { signSolanaLockTransaction } from '../src/signerPort';
import { browserAddressTestData } from './browserBuildTestData';
import { keypair } from './testUtils';

/** Captures the shared synthetic policy with one native or original SPL asset. */
const profileFor = (network: 'mainnet' | 'testnet', spl = false) => {
  const policy: SolanaLockAssetPolicy = {
    kind: spl ? 'spl' : 'native',
    sourceDecimals: spl ? 6 : 9,
    destinationDecimals: spl ? 6 : 9,
    destinationTokenId: 'cd'.repeat(32),
    minimumGrossAmount: '1000',
    maximumGrossAmount: '10000000',
    networkFee: '100',
    bridgeFee: '200',
    ...(spl ? { vaultTokenAccount: keypair(67).publicKey.toBase58() } : {}),
  };
  return captureSolanaLockProfile({
    clusterGenesisHash: keypair(7).publicKey.toBase58(),
    destinationNetwork: network,
    vaultOwner: keypair(41).publicKey.toBase58(),
    memoVersion: 1,
    assets: { [spl ? keypair(53).publicKey.toBase58() : 'SOL']: policy },
  });
};
/** Supplies a deterministic unsigned request for the selected synthetic asset. */
const requestFor = (destinationAddress: string, spl = false) => ({
  asset: spl ? keypair(53).publicKey.toBase58() : 'SOL',
  grossAmount: '10000',
  destinationAddress,
  senderAddress: keypair(83).publicKey.toBase58(),
  recentBlockhash: keypair(101).publicKey.toBase58(),
  ...(spl ? { sourceTokenAccount: keypair(113).publicKey.toBase58() } : {}),
});
/** Renders bytes without relying on a global Buffer. */
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
/** Fails the browser fixture at the exact violated invariant. */
const assert = (condition: unknown, label: string) => {
  if (!condition) throw new Error(label);
};
/** Requires each browser fail-closed branch to reject its isolated mutation. */
const rejects = async (action: () => unknown, label: string) => {
  let rejected = false;
  try {
    await action();
  } catch {
    rejected = true;
  }
  assert(rejected, label);
};

/** Evaluates the actual captured-network address policy in the bundled realm. */
export const addressOutcomes = (cases: { address: unknown; network: 'mainnet' | 'testnet' }[]) =>
  cases.map(({ address, network }) => {
    let accepted = false;
    try {
      validateSolanaLockTarget(address, profileFor(network));
      accepted = true;
    } catch {}
    return accepted;
  });

/** Replays the shared canonical/network policy cases in the actual browser realm. */
export const runBrowserAddressChecks = () => {
  const outcomes = addressOutcomes(browserAddressTestData);
  outcomes.forEach((accepted, index) =>
    assert(accepted === browserAddressTestData[index].accepted, `Address case ${index} diverged`),
  );
  return outcomes;
};

/** Exercises SOL/SPL message and signature joins with preserved capture identities. */
export const runBrowserProbes = async (destination: string) => {
  assert(typeof globalThis.Buffer === 'undefined', 'No browser-global Buffer should be installed');
  const profile = profileFor('mainnet');
  assert(isCapturedSolanaLockProfile(profile), 'Original profile capture lost');
  assert(Object.isFrozen(profile) && Object.isFrozen(profile.assets.SOL), 'Profile freeze lost');
  const cloned = structuredClone(profile);
  assert(!isCapturedSolanaLockProfile(cloned), 'Cloned profile acquired capture identity');
  await rejects(
    () => buildSolanaLockMessage(cloned, requestFor(destination)),
    'Cloned profile accepted',
  );
  const builds = [];
  for (const spl of [false, true]) {
    const build = buildSolanaLockMessage(profileFor('mainnet', spl), requestFor(destination, spl));
    assert(build.transaction.instructions.length === 2, 'Instruction ordering lost');
    assert(
      build.transaction.compileMessage().header.numRequiredSignatures === 1,
      'Unsigned signer requirement lost',
    );
    assert(
      build.transaction.signatures.every((entry) => entry.signature === null),
      'Transaction was presigned',
    );
    const before = hex(build.transaction.serializeMessage());
    const signed = await signSolanaLockTransaction(build, {
      getPublicKey: () => keypair(83).publicKey.toBase58(),
      signTransaction: async (transaction) => {
        transaction.partialSign(keypair(83));
        return transaction;
      },
    });
    assert(hex(signed.serializeMessage()) === before, 'Signed message bytes changed');
    assert(signed.verifySignatures(), 'Synthetic signature failed');
    assert(hasCapturedSolanaLockMessage(build, signed), 'WeakMap message identity lost');
    await rejects(
      () =>
        signSolanaLockTransaction(
          { ...build },
          {
            getPublicKey: () => keypair(83).publicKey.toBase58(),
            signTransaction: async (transaction) => transaction,
          },
        ),
      'Copied build acquired WeakMap evidence',
    );
    const changed = buildSolanaLockMessage(
      profileFor('mainnet', spl),
      requestFor(destination, spl),
    );
    changed.transaction.recentBlockhash = keypair(127).publicKey.toBase58();
    await rejects(
      () =>
        signSolanaLockTransaction(changed, {
          getPublicKey: () => keypair(83).publicKey.toBase58(),
          signTransaction: async (transaction) => transaction,
        }),
      'Changed message accepted',
    );
    await rejects(
      () =>
        signSolanaLockTransaction(build, {
          getPublicKey: () => keypair(127).publicKey.toBase58(),
          signTransaction: async (transaction) => transaction,
        }),
      'Wrong wallet accepted',
    );
    await rejects(
      () =>
        signSolanaLockTransaction(build, {
          getPublicKey: () => keypair(83).publicKey.toBase58(),
          signTransaction: async (transaction) => transaction,
        }),
      'Missing signature accepted',
    );
    await rejects(
      () =>
        signSolanaLockTransaction(build, {
          getPublicKey: () => keypair(83).publicKey.toBase58(),
          signTransaction: async (transaction) => {
            const changed = Transaction.from(
              transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
            );
            changed.recentBlockhash = keypair(127).publicKey.toBase58();
            changed.partialSign(keypair(83));
            return changed;
          },
        }),
      'Signed changed message accepted',
    );
    const signature = signed.signatures[0].signature;
    if (!signature) throw new Error('Missing captured synthetic signature');
    builds.push({
      asset: build.asset,
      messageHex: before,
      signatureHex: hex(signature),
      wireBytes: signed.serialize().length,
    });
  }
  return {
    exports: {
      Address: typeof ergo.Address,
      NetworkPrefix: ergo.NetworkPrefix,
      defaultExport: 'default' in ergo,
      init: 'init' in ergo,
    },
    absentGlobals: {
      Buffer: typeof globalThis.Buffer,
      process: typeof globalThis.process,
      require: typeof globalThis.require,
    },
    buildIdentityChecks: 15,
    builds,
  };
};
