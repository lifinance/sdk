---
'@lifi/sdk-provider-solana': minor
'@lifi/sdk-provider-bitcoin': patch
'@lifi/sdk-provider-ethereum': patch
'@lifi/sdk-provider-sui': patch
'@lifi/sdk-provider-tron': patch
---

Bump runtime dependencies.

- `@solana/kit` 7.1.0 → 8.0.0 (`@lifi/sdk-provider-solana`)
- `@bitcoinerlab/secp256k1` 1.2.0 → 2.0.0 (`@lifi/sdk-provider-bitcoin`)
- `tronweb` 6.4.0 → 6.5.0 (`@lifi/sdk-provider-tron`)
- `viem` 2.55.17 → 2.55.19 (`@lifi/sdk-provider-ethereum`)
- `@mysten/sui` 2.26.1 → 2.26.2 (`@lifi/sdk-provider-sui`)

Both majors are no-ops for this SDK's own code, but the `@solana/kit` one is not a
no-op for integrators.

`@solana/kit` 8.0.0 removes the deprecated compute-unit-limit estimation helpers,
`getBigIntDowncastRequestTransformer`, the fixed transaction size constants
(`TRANSACTION_PACKET_SIZE`, `TRANSACTION_PACKET_HEADER`, `TRANSACTION_SIZE_LIMIT`), and
several `@solana/instruction-plans` result types, and it stops writing to the execution
context in `createTransactionPlanExecutor`. This package uses none of them, so no
migration was needed here. `assertIsTransactionWithinSizeLimit` survives, and its
threshold is now version-aware rather than a single constant.

Minor rather than patch for `@lifi/sdk-provider-solana`: no exported signature changes,
but `@solana/kit` is a regular dependency whose types reach this package's public
surface — `toAddress` is re-exported from it, and `SolanaProviderOptions.signedTransactions`
is typed with its `Transaction`. Integrators who also depend on `@solana/kit` directly
must move to 8.x, or they will resolve two copies whose types do not interchange.

`@bitcoinerlab/secp256k1` 2.0.0 moves to `@noble/curves` 2.3.0 and raises its Node floor
to 20.19. It is used only internally, passed to `bitcoinjs-lib`'s `initEccLib` for
Taproot signing, and it still passes that function's BIP340/341 verification vectors for
`isXOnlyPoint` and `xOnlyPointAddTweak`, so P2TR behavior is unchanged.

`@stellar/stellar-sdk` 17.0.0 is available but deliberately not taken here; it stays on
16.2.0.
