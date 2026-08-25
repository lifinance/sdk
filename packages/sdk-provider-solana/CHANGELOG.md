# @lifi/sdk-provider-solana

## 4.1.0

### Minor Changes

- [#454](https://github.com/lifinance/sdk/pull/454) [`d86f36f`](https://github.com/lifinance/sdk/commit/d86f36f6c85d738a97ad8207e5e519fbefee7040) Thanks [@chybisov](https://github.com/chybisov)! - Bump `@solana/kit` from 7.1.0 to 8.0.0.
  
  v8 removes the deprecated compute-unit-limit estimation helpers
  (`estimateComputeUnitLimitFactory`, `estimateAndSetComputeUnitLimitFactory`,
  `fillTransactionMessageProvisoryComputeUnitLimit`), `getBigIntDowncastRequestTransformer`,
  the fixed transaction size constants (`TRANSACTION_PACKET_SIZE`,
  `TRANSACTION_PACKET_HEADER`, `TRANSACTION_SIZE_LIMIT`), and several
  `@solana/instruction-plans` result types, and it stops writing to the execution context in
  `createTransactionPlanExecutor`. This package uses none of them, so no migration was
  needed. `assertIsTransactionWithinSizeLimit` survives, and its threshold is now
  transaction-version-aware rather than a single constant.
  
  Minor rather than patch: no exported signature changes, but `@solana/kit` is a regular
  dependency whose types reach this package's public surface — `toAddress` is re-exported
  from it, and `SolanaProviderOptions.signedTransactions` is typed with its `Transaction`.
  Integrators who also depend on `@solana/kit` directly must move to 8.x, or they will
  resolve two copies whose types do not interchange.

- [#448](https://github.com/lifinance/sdk/pull/448) [`1ab67e5`](https://github.com/lifinance/sdk/commit/1ab67e5b5d89446a9c08530c6d9c296179e1a359) Thanks [@chybisov](https://github.com/chybisov)! - Fix false `TransactionExpired` errors on Solana swaps that confirmed on-chain.
  
  Confirmation stopped polling by comparing `getBlockHeight()` against a freshly
  fetched blockhash's `lastValidBlockHeight`. At least one endpoint in the
  default RPC set answers `getBlockHeight` with the slot number (~22M higher), so
  that comparison was false on its first evaluation and the endpoint never polled
  at all. Every swap then depended on the remaining endpoint alone.
  
  Polling now stops when the signed transaction's own blockhash dies, probed via
  `isBlockhashValid`, and in any case after a 90 second ceiling. `getBlockHeight`
  is never read. The wait is hard-bounded: branches abort 5 seconds after the
  ceiling, so allow ~95 seconds for the confirmation phase. A branch also gives up
  early once its endpoint has gone 30 seconds without answering a status read,
  which is long enough to ride out a throttling window rather than end the swap
  inside one.
  
  Minor rather than patch: no exported signature changes, but the error
  classification integrators branch on does. Transitions, old → new:
  
  - Standard path, no RPC returned a usable response: `TransactionError`
    `TransactionExpired` (1018) → `RPCError` `RpcUnavailable` (1027).
  - Jito path, bundle never confirmed: `UnknownError` `InternalError` (1000) →
    `TransactionError` `TransactionExpired` (1018).
  - Jito path, every Jito RPC failed: `UnknownError` (1000) → `RPCError` (1027).
  - Jito path, no RPC supports bundle methods: `UnknownError` (1000) → `RPCError`
    (1027).
  - Jito path, confirmed bundle whose signatures an RPC had not indexed yet:
    `TransactionError` `TransactionFailed` (1003) → success.
  - Jito path, confirmed bundle whose status omits `transactions`:
    `UnknownError` (1000) → success.
  - Either path, a signed transaction carrying no fee payer signature: raw
    `SolanaError` → `TransactionError` `TransactionUnprepared` (1002). Both wait
    tasks read the signature before they submit, so this throw now stays inside
    the `LiFiErrorCode` contract instead of reaching integrator error branching
    as an unclassified error.
  
  A confirmed Jito bundle no longer fails on missing per-signature data. A bundle
  is atomic, so a `confirmed` status means every transaction in it landed; a
  `null` or absent `getSignatureStatuses` result is indexing lag, not failure.
  The bundle-level `err` is now read as well.
  
  `txHash` and `txLink` are both recorded when the first RPC accepts the send,
  rather than only after confirmation. A swap that broadcast and then failed to
  confirm now reports its signature, so it can be looked up on chain. Neither is
  written at signing time: a signed-but-unsent signature resolves to `null` on
  every explorer, and simulation, a send failure, or a bundle route with no
  Jito-capable RPC all sit between signing and the first broadcast. Signing does
  clear both fields, so a route resumed from storage no longer reports the previous
  run's signature - including when decoding the signed transaction fails, since
  the clearing write now precedes the decode. A throwing `updateRouteHook` no
  longer fails the step from the broadcast callback, and no longer changes which
  error a failed confirmation reports. The action writes that follow a verdict
  are not guarded: a hook that throws there still fails the step, as before.
  
  Jito capability is probed once per endpoint and cached, rather than re-probed
  before every bundle submission, and concurrent submissions now share one probe
  per URL instead of each firing their own. Each cached answer carries its own
  retry window. An endpoint that names the method unknown over JSON-RPC is
  believed permanently; a bare HTTP 401 or 403 is not, because it never reached
  the JSON-RPC layer and cannot distinguish a plan restriction from a provider
  mid-deploy or an allowlist entry still propagating. Those retry after 15
  minutes, so one transient refusal no longer removes a working endpoint for the
  lifetime of the process.
  
  For integrators: routes the backend builds as Jito bundles need a Jito-capable
  Solana RPC. The default set has none, and for `ChainId.SOL` URLs supplied via
  `rpcUrls` replace the defaults rather than merging. Without one, such a route
  fails before submission with `RpcUnavailable` (1027).

### Patch Changes

- [#448](https://github.com/lifinance/sdk/pull/448) [`1ab67e5`](https://github.com/lifinance/sdk/commit/1ab67e5b5d89446a9c08530c6d9c296179e1a359) Thanks [@chybisov](https://github.com/chybisov)! - Fix `KeypairWalletAdapter`, which could not sign any real transaction.
  
  `assertIsTransactionWithBlockhashLifetime` tested for a `lifetimeConstraint`
  property that no `@solana/kit` decoder reconstructs, so every transaction was
  rejected with `Transaction does not have a blockhash lifetime`. Signing never
  needed it — the blockhash travels inside `messageBytes`.
  
  The result then re-encoded the pre-signing object, discarding the signature,
  because `partiallySignTransaction` returns a new transaction rather than
  mutating its argument.
  
  The adapter is test-only, so no production integration is affected.
  
  Also removes the unused `isJitoRpc` helper, superseded by `probeJitoRpc`.
- Updated dependencies [[`1ab67e5`](https://github.com/lifinance/sdk/commit/1ab67e5b5d89446a9c08530c6d9c296179e1a359)]:
  - @lifi/sdk@4.5.0

## 4.0.7

### Patch Changes

- [#446](https://github.com/lifinance/sdk/pull/446) [`633eede`](https://github.com/lifinance/sdk/commit/633eededca5450ab1cdc89a871cc5f2d6038588b) Thanks [@chybisov](https://github.com/chybisov)! - Bump runtime dependencies: viem to 2.55.17 (ethereum), @solana/kit to 7.1.0 (solana), and @mysten/sui to 2.26.1 (sui).

## 4.0.6

### Patch Changes

- Updated dependencies [[`fd1e9b5`](https://github.com/lifinance/sdk/commit/fd1e9b5ff481b35683d7b8557011c9c726446cdd)]:
  - @lifi/sdk@4.4.0

## 4.0.5

### Patch Changes

- [#409](https://github.com/lifinance/sdk/pull/409) [`f6f8865`](https://github.com/lifinance/sdk/commit/f6f88653ead19f0f2279d7ad9af6851892211912) Thanks [@chybisov](https://github.com/chybisov)! - Fix Solana Jito bundle execution (EMB-462). The executor now routes by the shape of the backend's `transactionRequest.data` — an array is submitted via `sendBundle`, a string via `sendTransaction` — instead of inferring it from the signed-transaction count. The Jito-capable RPC probe now uses `getBundleStatuses` instead of `getTipAccounts`, so providers such as Helius (which support `sendBundle`/`getBundleStatuses` but not `getTipAccounts`) are correctly detected and bundles submit successfully.

- Updated dependencies [[`d8b7adb`](https://github.com/lifinance/sdk/commit/d8b7adb6f797734f25d8c7d458121752a2567998), [`08b54da`](https://github.com/lifinance/sdk/commit/08b54dadebef063bc20af06630f0e43ec5850dca)]:
  - @lifi/sdk@4.3.0

## 4.0.4

### Patch Changes

- Updated dependencies [[`0990a5d`](https://github.com/lifinance/sdk/commit/0990a5d2dcb148c113e41aeeab38eb1bcc5c684e)]:
  - @lifi/sdk@4.2.0

## 4.0.3

### Patch Changes

- [#422](https://github.com/lifinance/sdk/pull/422) [`e7f2f97`](https://github.com/lifinance/sdk/commit/e7f2f975031cd43f3e39c03dd6bb16b661d4bf0b) Thanks [@chybisov](https://github.com/chybisov)! - Bump runtime dependencies: viem to 2.54.6 and @solana/kit to 7.0.0.

## 4.0.2

### Patch Changes

- Updated dependencies [[`e8c8b69`](https://github.com/lifinance/sdk/commit/e8c8b6999ba8ffc127d47ba4a648d0a2792a4870), [`82b6c17`](https://github.com/lifinance/sdk/commit/82b6c17ceadfe3968e27e2c7bb3b8a1a0ded1840), [`2ced1e4`](https://github.com/lifinance/sdk/commit/2ced1e4881923ac14e110b3009150a5bd4f9d318), [`6e1b100`](https://github.com/lifinance/sdk/commit/6e1b1009700561571d0dca864f539129951c162b)]:
  - @lifi/sdk@4.1.0

## 4.0.1

### Patch Changes

- [#402](https://github.com/lifinance/sdk/pull/402) [`bf3d047`](https://github.com/lifinance/sdk/commit/bf3d047ebdc9a8b3a5a6362f65d25aa1eb652ffa) Thanks [@chybisov](https://github.com/chybisov)! - Bump runtime dependencies: @lifi/types to 17.85.0, viem to 2.52.2, @solana/kit to 6.10.0 (with @solana/wallet-standard-features and @wallet-standard/base), @mysten/sui to 2.19.0, and @tronweb3/tronwallet-abstract-adapter to 1.2.0.

- Updated dependencies [[`bf3d047`](https://github.com/lifinance/sdk/commit/bf3d047ebdc9a8b3a5a6362f65d25aa1eb652ffa)]:
  - @lifi/sdk@4.0.1

## 4.0.0

### Patch Changes

- [#387](https://github.com/lifinance/sdk/pull/387) [`12ee1f1`](https://github.com/lifinance/sdk/commit/12ee1f1bf7e79b67842d4d8ca606a80fe0913653) Thanks [@chybisov](https://github.com/chybisov)! - Preserve Solana RPC error details on failed transactions. The structured `err` payload (and `logs`, for simulation failures) from a failed simulation or confirmation is now attached to the thrown `TransactionError`'s `cause` as a new `SolanaTransactionDetailsError`, so consumers can inspect the original error and logs directly without re-simulating. `SolanaTransactionDetailsError` is exported from the package root.

- Updated dependencies []:
  - @lifi/sdk@4.0.0

## 4.0.0-beta.12

### Patch Changes

- [#387](https://github.com/lifinance/sdk/pull/387) [`12ee1f1`](https://github.com/lifinance/sdk/commit/12ee1f1bf7e79b67842d4d8ca606a80fe0913653) Thanks [@chybisov](https://github.com/chybisov)! - Preserve Solana RPC error details on failed transactions. The structured `err` payload (and `logs`, for simulation failures) from a failed simulation or confirmation is now attached to the thrown `TransactionError`'s `cause` as a new `SolanaTransactionDetailsError`, so consumers can inspect the original error and logs directly without re-simulating. `SolanaTransactionDetailsError` is exported from the package root.
