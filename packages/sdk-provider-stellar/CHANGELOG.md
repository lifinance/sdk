# @lifi/sdk-provider-stellar

## 4.2.4

### Patch Changes

- [#462](https://github.com/lifinance/sdk/pull/462) [`83a179b`](https://github.com/lifinance/sdk/commit/83a179b2d25d84a38e8ff9972f46508dd0a970c3) Thanks [@thesems](https://github.com/thesems)! - Bid the live Soroban inclusion fee for the approval transaction instead of the network minimum, so it doesn't expire unincluded on a congested ledger.

## 4.2.3

### Patch Changes

- [#457](https://github.com/lifinance/sdk/pull/457) [`71b03eb`](https://github.com/lifinance/sdk/commit/71b03eb93d8d9af42759e05a359260f5ffd1e87f) Thanks [@chybisov](https://github.com/chybisov)! - Bump `@stellar/stellar-sdk` from 16.2.0 to 17.0.1.
  
  v17 rebuilds the XDR namespace as a class based API and switches every byte
  returning API from `Buffer` to `Uint8Array`. The public API of this package is
  unchanged.
  
  `deriveTransactionHash` called `.toString('hex')` on the result of
  `transaction.hash()`. That is a `Uint8Array` now, whose `toString` ignores the
  argument and returns comma separated decimals, so the digest is built from the
  bytes instead. The helper still returns the same 64 character lowercase hex
  string, which `StellarSignAndExecuteTask.unit.spec.ts` asserts against an
  independently computed digest.
  
  `submitStellarTransaction` and `waitForStellarTransaction` read the failure
  reason through `result().switch().name`. The generated XDR classes expose
  `result` as a readonly field with a `type` discriminant, so both read
  `result.type`. The variant names are unchanged, and a new test pins the failure
  variant into the error message.
  
  `toXDR` and `TransactionBuilder.fromXDR` are both deprecated in v17 in favour of
  `toXdr` and `fromXdr`, and both remain as aliases. All seven call sites moved to
  the new names.
  
  Two behaviour notes that need no code change here. v17 raises its Node floor to
  22.12.0, and CI runs Node 26. v17 also sends `useUpgradedAuth: true` on every
  simulation rather than omitting the key, which turns on CAP-71 address
  credentials. The two read paths simulate methods that need no authorization, and
  the approve path authorizes with the transaction source account, so a live
  mainnet simulation records `sorobanCredentialsSourceAccount` and the flag has no
  effect. Mainnet is on protocol 27, which activates CAP-71 in any case.
- Updated dependencies [[`954bc4b`](https://github.com/lifinance/sdk/commit/954bc4bda013b470102041810daf95cb4f9181a1)]:
  - @lifi/sdk@4.6.1

## 4.2.2

### Patch Changes

- Updated dependencies [[`b5ace9d`](https://github.com/lifinance/sdk/commit/b5ace9d9a2a0267ae4231b42035b55a0e1def72e)]:
  - @lifi/sdk@4.6.0

## 4.2.1

### Patch Changes

- Updated dependencies [[`1ab67e5`](https://github.com/lifinance/sdk/commit/1ab67e5b5d89446a9c08530c6d9c296179e1a359)]:
  - @lifi/sdk@4.5.0

## 4.2.0

### Minor Changes

- [`fd1e9b5`](https://github.com/lifinance/sdk/commit/fd1e9b5ff481b35683d7b8557011c9c726446cdd) Thanks [@chybisov](https://github.com/chybisov)! - Add Stellar (STL) ecosystem support. Introduces the `@lifi/sdk-provider-stellar` package — address validation, Federation resolution, SAC-based balance reads, and route execution via `StellarStepExecutor` — and registers `ChainType.STL` in the SDK client's chain fetching so Stellar chains and RPC URLs load.
  
  Execution signs the backend-generated Soroban envelope with the connected wallet, submits it over Stellar RPC, waits for on-chain confirmation, then tracks the transfer through the LI.FI status API. Because a Stellar envelope embeds the sender's account sequence number and a short-lived set of timebounds, the provider always requests a freshly built transaction immediately before signing rather than reusing the one attached to the quote. SAC allowances are granted first when a step requires one, and the approval is confirmed on-chain before the route transaction is requested.
  
  `PrepareTransactionTask` gains a `shouldRefetchTransaction` hook. It defaults to the previous behaviour — fetch only when the step carries no transaction request — and the Stellar task overrides it, because a Stellar envelope embeds the sender's sequence number and cannot be reused.
  
  `StellarProviderOptions.horizonUrl` is gone — nothing read it — and `StellarWallet.signAuthEntry` is now optional, because the router routes use source-account auth and the SDK never calls it. The provider also exports `DEFAULT_NETWORK_PASSPHRASE`, and refuses to sign when the connected wallet's network disagrees with the configured one.

### Patch Changes

- Updated dependencies [[`fd1e9b5`](https://github.com/lifinance/sdk/commit/fd1e9b5ff481b35683d7b8557011c9c726446cdd)]:
  - @lifi/sdk@4.4.0
