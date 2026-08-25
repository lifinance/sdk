# @lifi/sdk-provider-ethereum

## 4.0.11

### Patch Changes

- [#454](https://github.com/lifinance/sdk/pull/454) [`d86f36f`](https://github.com/lifinance/sdk/commit/d86f36f6c85d738a97ad8207e5e519fbefee7040) Thanks [@chybisov](https://github.com/chybisov)! - Bump runtime dependencies: `viem` to 2.55.19, `@mysten/sui` to 2.26.2, `tronweb` to 6.5.0.
- Updated dependencies [[`1ab67e5`](https://github.com/lifinance/sdk/commit/1ab67e5b5d89446a9c08530c6d9c296179e1a359)]:
  - @lifi/sdk@4.5.0

## 4.0.10

### Patch Changes

- [#446](https://github.com/lifinance/sdk/pull/446) [`633eede`](https://github.com/lifinance/sdk/commit/633eededca5450ab1cdc89a871cc5f2d6038588b) Thanks [@chybisov](https://github.com/chybisov)! - Bump runtime dependencies: viem to 2.55.17 (ethereum), @solana/kit to 7.1.0 (solana), and @mysten/sui to 2.26.1 (sui).

## 4.0.9

### Patch Changes

- [#438](https://github.com/lifinance/sdk/pull/438) [`d12b5b6`](https://github.com/lifinance/sdk/commit/d12b5b69d5559ffc3ced76a072658172d6bbcffc) Thanks [@chmanie](https://github.com/chmanie)! - Fix `getAccountCode` treating a code-less account as a failed RPC lookup (viem's `getCode` returns `undefined` for both), suppressing native EIP-2612 permits for every plain EOA. Permit-supporting tokens now route through `callDiamondWithEIP2612Signature` rather than `callDiamondWithPermit2`, skipping the `approve(permit2)`.
  
  Fix Permit2 reverting for EIP-7702 delegated accounts. Permit2 verifies code-bearing signers via EIP-1271, where acceptance is implementation-specific, so the signer is now probed with a read-only `isValidSignature` call — only accounts that reject it fall back to approve + execute. The probe gates the standard transaction flow only — relayer-settled steps keep the spender they already used.
  
  `isSafeWallet` no longer queries the Safe Transaction Service for an address with no on-chain code. Its code-less short-circuit was unreachable while `getAccountCode` conflated "no code" with "RPC failed", so an undeployed or counterfactual Safe now resolves as a non-Safe wallet instead of falling through to the API. This surfaces through `resolveTransactionHash`, which returns such a value as a plain transaction hash rather than tracking it as a Safe signature.
- Updated dependencies [[`fd1e9b5`](https://github.com/lifinance/sdk/commit/fd1e9b5ff481b35683d7b8557011c9c726446cdd)]:
  - @lifi/sdk@4.4.0

## 4.0.8

### Patch Changes

- [#435](https://github.com/lifinance/sdk/pull/435) [`d8b7adb`](https://github.com/lifinance/sdk/commit/d8b7adb6f797734f25d8c7d458121752a2567998) Thanks [@chybisov](https://github.com/chybisov)! - Bump runtime dependencies: @lifi/types to 17.86.0 (sdk), viem to 2.55.8 (ethereum), and @mysten/sui to 2.22.1 (sui).

- Updated dependencies [[`d8b7adb`](https://github.com/lifinance/sdk/commit/d8b7adb6f797734f25d8c7d458121752a2567998), [`08b54da`](https://github.com/lifinance/sdk/commit/08b54dadebef063bc20af06630f0e43ec5850dca)]:
  - @lifi/sdk@4.3.0

## 4.0.7

### Patch Changes

- Updated dependencies [[`0990a5d`](https://github.com/lifinance/sdk/commit/0990a5d2dcb148c113e41aeeab38eb1bcc5c684e)]:
  - @lifi/sdk@4.2.0

## 4.0.6

### Patch Changes

- [#429](https://github.com/lifinance/sdk/pull/429) [`1de76f9`](https://github.com/lifinance/sdk/commit/1de76f93fcbdddc9df269581822036e4eecd3e78) Thanks [@chybisov](https://github.com/chybisov)! - Bump runtime dependencies: viem to 2.55.1 (ethereum), @bigmi/core to 0.9.0 (bitcoin), and @mysten/sui to 2.20.3 (sui).

## 4.0.5

### Patch Changes

- [#425](https://github.com/lifinance/sdk/pull/425) [`7ebebde`](https://github.com/lifinance/sdk/commit/7ebebde35415024f9966123556b882fdb2d7b1bc) Thanks [@chybisov](https://github.com/chybisov)! - Handle wallets that resolve `signTypedData` with a nullish or empty signature instead of rejecting ([#424](https://github.com/lifinance/sdk/issues/424)). The EIP-2612 native permit flow now falls back to the Permit2/standard approval path instead of crashing later with `TypeError: Cannot read properties of null (reading 'slice')`, and the other signing flows (API permits, relayed intents, Permit2 messages) throw a descriptive `SignatureRejected` error. Permit lookups also ignore stored entries without a usable signature.

## 4.0.4

### Patch Changes

- [#422](https://github.com/lifinance/sdk/pull/422) [`e7f2f97`](https://github.com/lifinance/sdk/commit/e7f2f975031cd43f3e39c03dd6bb16b661d4bf0b) Thanks [@chybisov](https://github.com/chybisov)! - Bump runtime dependencies: viem to 2.54.6 and @solana/kit to 7.0.0.

## 4.0.3

### Patch Changes

- Updated dependencies [[`e8c8b69`](https://github.com/lifinance/sdk/commit/e8c8b6999ba8ffc127d47ba4a648d0a2792a4870), [`82b6c17`](https://github.com/lifinance/sdk/commit/82b6c17ceadfe3968e27e2c7bb3b8a1a0ded1840), [`2ced1e4`](https://github.com/lifinance/sdk/commit/2ced1e4881923ac14e110b3009150a5bd4f9d318), [`6e1b100`](https://github.com/lifinance/sdk/commit/6e1b1009700561571d0dca864f539129951c162b)]:
  - @lifi/sdk@4.1.0

## 4.0.2

### Patch Changes

- [#406](https://github.com/lifinance/sdk/pull/406) [`f7775fc`](https://github.com/lifinance/sdk/commit/f7775fc5ec687aa5d01d1ef4db557faf08aa9144) Thanks [@chybisov](https://github.com/chybisov)! - Bump runtime dependency: viem to 2.53.1.

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
