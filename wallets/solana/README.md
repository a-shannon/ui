# Solana wallet

`@rosen-ui/solana-wallet` owns provider connection, captured sessions, signing
and one-use submission of native SOL and original-SPL source locks. It consumes
the reads, fee calculation and transaction construction in
`@rosen-network/solana`.

## Connection and captured sessions

`createEventBoundSolanaWalletPort` adapts a sign-only legacy provider with
removable `on`/`off` handlers. It subscribes before connecting and retires the
session on disconnect or account change, including a change followed by
restoration of the same account. Observed provider replacement or invalid key
also requires explicit reconnection. `dispose` retires the adapter and removes
both handlers without disconnecting the external provider.

`captureSession()` returns an immutable local identity.
`isCurrentSolanaWalletSession` checks the private capture and originating
connection. Copies are invalid. A retired capture never becomes current again.

The wallet's `readSolanaWalletBalance` and fee-quote helpers supply this actual
session validator to the network algorithms. They reject account or session
changes during external reads. Quote policy, selected SPL account and raw
amounts remain explicit inputs; amounts rounded for display are not budgets.

## Signing and submission

`signSolanaLockFeeQuote` revalidates before and after signing. The provider gets
a clone of the captured transaction. Verification decodes copied signed wire
into a fresh SDK transaction and checks its message, account and signature.
The result is a frozen opaque handle; the wallet's returned object and methods
are not trusted.

`revalidateSolanaSignedLock` retires the old handle before rereading the same
message's budget and expiry. It returns unchanged wire without signing again.
`submitSolanaSignedLock(lock, send)` performs that fresh check, consumes the
successor once and hands the configured callback frozen wire, its expected
signature and context slot. The callback must begin its transport handoff when
invoked. `createSolanaRpcSubmitProducer` from the network package implements
that contract.

Concurrent uses of one handle cannot invoke the callback twice. An exact
acknowledgment returns the expected transaction signature. Any callback failure
or mismatched acknowledgment raises `SolanaAmbiguousSubmissionError`, retaining
that signature and the original cause. Reconcile the signature before a new
attempt. Session changes after handoff cannot erase a possible submission.
There is no automatic retry, rebuild, confirmation or durable recovery journal.

## Build and tests

Build the network dependency before this package:

```sh
npm run build --workspace @rosen-network/solana
npm run build --workspace @rosen-ui/solana-wallet
npm run type-check --workspace @rosen-ui/solana-wallet
npm run lint:check --workspace @rosen-ui/solana-wallet
npm run test --workspace @rosen-ui/solana-wallet
npm run test:browser --workspace @rosen-ui/solana-wallet
npm pack --dry-run --workspace @rosen-ui/solana-wallet
```

Browser mappings reuse the network's generated Ergo and SPL adapters. The
separate browser suite bundles and executes signing, sessions and reads without
Node globals. Tests use synthetic keys and transports.

To replay the 21 session/read and 44 RPC wallet/fee controls against ordinary
installed archives with esbuild 0.25.10, run from this package directory:

```sh
node scripts/replay-installed-rpc-browser.mjs <consumer-directory> <new-evidence-directory>
```

The consumer must contain both installed Solana packages and esbuild. The new
evidence directory must be outside the checkout and consumer. The command
retains fixture, bundle and dependency pins and makes no network request.

The integration suite requires the companion Utils contribution built with its
Solana extractor. Set `ROSEN_EXTRACTOR_PACKAGE` to its `packages/rosen-extractor`
directory, then run the following command:

```sh
npm run test:integration --workspace @rosen-ui/solana-wallet
```

It projects signed messages through the extractor; it does not authenticate
finalized chain history.

The package is a private workspace at `0.0.0` with an initialization changeset.
The complete shared `Wallet` subclass and app registration remain to be
implemented against the reviewed integration contract. Extension qualification,
confirmation and operational recovery are separate consumer requirements.
