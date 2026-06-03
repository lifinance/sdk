# @lifi/sdk-provider-solana

## 4.0.0

### Patch Changes

- [#387](https://github.com/lifinance/sdk/pull/387) [`12ee1f1`](https://github.com/lifinance/sdk/commit/12ee1f1bf7e79b67842d4d8ca606a80fe0913653) Thanks [@chybisov](https://github.com/chybisov)! - Preserve Solana RPC error details on failed transactions. The structured `err` payload (and `logs`, for simulation failures) from a failed simulation or confirmation is now attached to the thrown `TransactionError`'s `cause` as a new `SolanaTransactionDetailsError`, so consumers can inspect the original error and logs directly without re-simulating. `SolanaTransactionDetailsError` is exported from the package root.

- Updated dependencies []:
  - @lifi/sdk@4.0.0

## 4.0.0-beta.12

### Patch Changes

- [#387](https://github.com/lifinance/sdk/pull/387) [`12ee1f1`](https://github.com/lifinance/sdk/commit/12ee1f1bf7e79b67842d4d8ca606a80fe0913653) Thanks [@chybisov](https://github.com/chybisov)! - Preserve Solana RPC error details on failed transactions. The structured `err` payload (and `logs`, for simulation failures) from a failed simulation or confirmation is now attached to the thrown `TransactionError`'s `cause` as a new `SolanaTransactionDetailsError`, so consumers can inspect the original error and logs directly without re-simulating. `SolanaTransactionDetailsError` is exported from the package root.
