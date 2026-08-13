# @lifi/sdk-provider-stellar

## 4.2.0

### Minor Changes

- [#427](https://github.com/lifinance/sdk/pull/427) [`3ec63b2`](https://github.com/lifinance/sdk/commit/3ec63b27e9b77601a4ad6b23e092e01f83c9d570) Thanks [@chybisov](https://github.com/chybisov)! - Add Stellar (STL) ecosystem support. Introduces the `@lifi/sdk-provider-stellar` package — address validation, Federation resolution, SAC-based balance reads, and route execution via `StellarStepExecutor` — and registers `ChainType.STL` in the SDK client's chain fetching so Stellar chains and RPC URLs load.
  
  Execution signs the backend-generated Soroban envelope with the connected wallet, submits it over Stellar RPC, waits for on-chain confirmation, then tracks the transfer through the LI.FI status API. Because a Stellar envelope embeds the sender's account sequence number and a short-lived set of timebounds, the provider always requests a freshly built transaction immediately before signing rather than reusing the one attached to the quote. SAC allowances are granted first when a step requires one, and the approval is confirmed on-chain before the route transaction is requested.
  
  `PrepareTransactionTask` gains a `shouldRefetchTransaction` hook. It defaults to the previous behaviour — fetch only when the step carries no transaction request — and the Stellar task overrides it, because a Stellar envelope embeds the sender's sequence number and cannot be reused.
  
  `StellarProviderOptions.horizonUrl` is gone — nothing read it — and `StellarWallet.signAuthEntry` is now optional, because the router routes use source-account auth and the SDK never calls it. The provider also exports `DEFAULT_NETWORK_PASSPHRASE`, and refuses to sign when the connected wallet's network disagrees with the configured one.

### Patch Changes

- Updated dependencies [[`91a35b6`](https://github.com/lifinance/sdk/commit/91a35b656e602209fecb0286923499f786e439af), [`3ec63b2`](https://github.com/lifinance/sdk/commit/3ec63b27e9b77601a4ad6b23e092e01f83c9d570)]:
  - @lifi/sdk@4.4.0
