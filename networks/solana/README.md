# Solana network

`@rosen-network/solana` constructs source lock transactions for native SOL and
allowlisted original SPL Token Program mints. It provides account reads,
exact-message fee calculation and JSON-RPC submission. Wallet connection and
signing are in `@rosen-ui/solana-wallet`.

## Lock messages and amounts

`captureSolanaLockProfile` captures the cluster genesis hash, vault, asset
mappings, decimal scales, fees and amount limits. `buildSolanaLockMessage`
creates an unsigned legacy transaction with one payment followed by one Memo:
`SystemProgram.transfer` for SOL or `TransferChecked` for original SPL Token.
Memo v1 uses `SOL`; the source token map uses `sol`. Token-2022, wrapped SOL and
unlisted mints are unsupported. Both SPL accounts must already exist.

Amounts and fees are canonical unsigned decimal strings in source units.
Mappings must preserve exact destination units. Rosen fees are included in the
gross payment; the payer separately covers the Solana transaction fee. The
complete transaction must fit 1,232 bytes. The builder performs no RPC read.

## Account reads and fees

`createSolanaRpcWalletReadProducer` obtains raw SOL and original-SPL account
amounts at matching finalized slots above the requested floor. It validates
account bytes, owners, programs and mint precision. Every account remains
separate. The limit is 4,096 accounts, with independent HTTP/JSON byte budgets
that can reject a smaller inventory. Missing or malformed data rejects the
complete read.

`createSolanaRpcFeeProducers` obtains a finalized blockhash, zero-data System
payer balance, rent minimum, exact compiled-message fee and confirmed block
height. Both factories check the configured genesis before and after each
logical read. Rent and block height retain their scalar RPC meaning.

```ts
const readBalance = createSolanaRpcWalletReadProducer({ expectedGenesisHash, transport });
const producers = createSolanaRpcFeeProducers({ expectedGenesisHash, transport, readBalance });
```

`createSolanaLockFeeQuoteService(currentness)` captures the wallet-currentness
predicate supplied by its consumer. Its quote captures the intent, callbacks,
reserve policy and remaining-block margin before awaiting reads. Native locks
cover gross principal, message fee and reserve. SPL locks use one explicitly
selected initialized account and cover fees/reserve from SOL. The indicative
maximum respects the asset ceiling and exact conversion quantum.

Revalidation retires the old quote before external reads and retains the same
message and blockhash. A copied build cannot change the retained message.
`readSolanaWalletBalance` also requires a currentness predicate;
`@rosen-ui/solana-wallet` supplies the validator for its captured sessions.
`selectSolanaSourceTokenAccount` never sums accounts or silently chooses one.

Matching slots and genesis replies are service assertions, not independently
authenticated history or an atomic snapshot. Raw SOL inventory alone does not
establish fee-payer eligibility. Profiles and reserve policies require explicit
configuration.

## RPC transport and submission

`createRpcCaller` correlates responses with increasing safe integer request IDs.
Its parser preserves integer spellings as bigint and rejects duplicate keys,
invalid envelopes, fractions, exponents and u64 overflow. Limits are 1 MiB of
UTF-8, depth 64 and 100,000 JSON nodes.

`createSolanaRpcTransport` uses a supplied endpoint and fetch implementation.
It bounds request/response bytes, preserves bigint request tokens, decodes
strict UTF-8 and applies timeout/abort to headers and body. It does not retry.

`createSolanaRpcSubmitProducer(transport)` accepts signed-wire requests from
the wallet submission path. It verifies canonical wire, one valid signature,
the expected signature and u64 context slot before invoking the configured
transport. `sendTransaction` uses base64, preflight enabled, finalized preflight
commitment, `maxRetries: 0` and the captured context floor. Only an acknowledgment
equal to the captured signature is returned. That acknowledgment does not
establish confirmation or successful execution.

## Build and tests

Run from the UI workspace after installing dependencies:

```sh
npm run build --workspace @rosen-network/solana
npm run type-check --workspace @rosen-network/solana
npm run lint:check --workspace @rosen-network/solana
npm run test --workspace @rosen-network/solana
npm pack --dry-run --workspace @rosen-network/solana
```

The build generates browser adapters from pinned Ergo WASM/browser 0.24.1 and
SPL Token 0.4.14 with esbuild 0.25.10. The package browser map selects them;
Node consumers retain the Node WASM binding. Generation verifies source bytes
and emits an artifact manifest and complete dependency notices in
`dist/THIRD_PARTY_NOTICES.txt`. The tarball includes `dist`, LICENSE and README;
`prepack` builds first. Wallet browser tests exercise these adapters together
with signing and session handling.

This private `0.0.0` package has an initialization changeset. It does not yet
implement the complete shared `Network` class or app registration. Memo v1,
production mappings and the final integration contract require Rosen review.
