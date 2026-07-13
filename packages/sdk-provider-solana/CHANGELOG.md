# @lifi/sdk-provider-solana

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
