# @lifi/sdk-provider-sui

## 4.1.4

### Patch Changes

- Updated dependencies [[`0990a5d`](https://github.com/lifinance/sdk/commit/0990a5d2dcb148c113e41aeeab38eb1bcc5c684e)]:
  - @lifi/sdk@4.2.0

## 4.1.3

### Patch Changes

- [#429](https://github.com/lifinance/sdk/pull/429) [`1de76f9`](https://github.com/lifinance/sdk/commit/1de76f93fcbdddc9df269581822036e4eecd3e78) Thanks [@chybisov](https://github.com/chybisov)! - Bump runtime dependencies: viem to 2.55.1 (ethereum), @bigmi/core to 0.9.0 (bitcoin), and @mysten/sui to 2.20.3 (sui).

## 4.1.2

### Patch Changes

- [#419](https://github.com/lifinance/sdk/pull/419) [`a3be034`](https://github.com/lifinance/sdk/commit/a3be034330f9815d462d526accece8f630c83345) Thanks [@chybisov](https://github.com/chybisov)! - Bump runtime dependencies: @mysten/sui to 2.20.1 and tronweb to 6.4.0.

## 4.1.1

### Patch Changes

- [#407](https://github.com/lifinance/sdk/pull/407) [`2254196`](https://github.com/lifinance/sdk/commit/2254196129bccec1ba8d3afe8e7a4cb714230831) Thanks [@chybisov](https://github.com/chybisov)! - Use the `getJsonRpcFullnodeUrl` helper for the default Sui fullnode URL in SuiNS resolution instead of a hardcoded string. No behavior change — the helper returns the same mainnet endpoint.

- Updated dependencies [[`e8c8b69`](https://github.com/lifinance/sdk/commit/e8c8b6999ba8ffc127d47ba4a648d0a2792a4870), [`82b6c17`](https://github.com/lifinance/sdk/commit/82b6c17ceadfe3968e27e2c7bb3b8a1a0ded1840), [`2ced1e4`](https://github.com/lifinance/sdk/commit/2ced1e4881923ac14e110b3009150a5bd4f9d318), [`6e1b100`](https://github.com/lifinance/sdk/commit/6e1b1009700561571d0dca864f539129951c162b)]:
  - @lifi/sdk@4.1.0

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
