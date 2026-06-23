# @lifi/sdk-provider-sui

## 4.1.0

### Minor Changes

- [#404](https://github.com/lifinance/sdk/pull/404) [`e85d5e7`](https://github.com/lifinance/sdk/commit/e85d5e7c2da581a2397429392e14f2d47b4efa87) Thanks [@chybisov](https://github.com/chybisov)! - Migrate the Sui integration off the deprecated JSON-RPC client (`SuiJsonRpcClient`) to the gRPC Core API (`SuiGrpcClient` / `client.core.*`) ahead of Sui's JSON-RPC sunset. Balance fetching (`listBalances`, now paginated), latest-checkpoint lookup (`ledgerService.getServiceInfo`), transaction confirmation (`core.waitForTransaction`), and SuiNS resolution (`nameService.lookupName`) now use gRPC. No public API changes.

## 4.0.1

### Patch Changes

- [#402](https://github.com/lifinance/sdk/pull/402) [`bf3d047`](https://github.com/lifinance/sdk/commit/bf3d047ebdc9a8b3a5a6362f65d25aa1eb652ffa) Thanks [@chybisov](https://github.com/chybisov)! - Bump runtime dependencies: @lifi/types to 17.85.0, viem to 2.52.2, @solana/kit to 6.10.0 (with @solana/wallet-standard-features and @wallet-standard/base), @mysten/sui to 2.19.0, and @tronweb3/tronwallet-abstract-adapter to 1.2.0.

- Updated dependencies [[`bf3d047`](https://github.com/lifinance/sdk/commit/bf3d047ebdc9a8b3a5a6362f65d25aa1eb652ffa)]:
  - @lifi/sdk@4.0.1

## 4.0.0

### Patch Changes

- [#396](https://github.com/lifinance/sdk/pull/396) [`8a8773f`](https://github.com/lifinance/sdk/commit/8a8773f4bbd6d5245fc933b140502b87e1c953c8) Thanks [@chybisov](https://github.com/chybisov)! - Bump runtime dependencies: viem to 2.51.3, @mysten/sui to 2.17.0.

- Updated dependencies []:
  - @lifi/sdk@4.0.0

## 4.0.0-beta.12

### Patch Changes

- [#396](https://github.com/lifinance/sdk/pull/396) [`8a8773f`](https://github.com/lifinance/sdk/commit/8a8773f4bbd6d5245fc933b140502b87e1c953c8) Thanks [@chybisov](https://github.com/chybisov)! - Bump runtime dependencies: viem to 2.51.3, @mysten/sui to 2.17.0.
