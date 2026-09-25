# @lifi/sdk-provider-ethereum

## 4.2.4

### Patch Changes

- Updated dependencies [[`dcbbdcc`](https://github.com/lifinance/sdk/commit/dcbbdccc2684c4549cbfe06444698f11347206af)]:
  - @lifi/sdk@4.9.1

## 4.2.3

### Patch Changes

- Updated dependencies [[`a65b003`](https://github.com/lifinance/sdk/commit/a65b00391698c3e8c2a1cd826bb0969c6977ecb6), [`9e815bd`](https://github.com/lifinance/sdk/commit/9e815bdd0d818b7e0866c78bdf48065185b64210), [`145f2b4`](https://github.com/lifinance/sdk/commit/145f2b49dbbc55776e0b0fe34b0b890f3e5be199)]:
  - @lifi/sdk@4.9.0

## 4.2.2

### Patch Changes

- Updated dependencies [[`1a7c966`](https://github.com/lifinance/sdk/commit/1a7c96646e7a5696443b5a88485bdfb33b51682d), [`b17e93e`](https://github.com/lifinance/sdk/commit/b17e93ebc3303e34913d41dba4b71a99897138b6)]:
  - @lifi/sdk@4.8.2

## 4.2.1

### Patch Changes

- Updated dependencies [[`621d410`](https://github.com/lifinance/sdk/commit/621d410db320188677df50f5ec5bf4a1c65bf818)]:
  - @lifi/sdk@4.8.1

## 4.2.0

### Minor Changes

- [#475](https://github.com/lifinance/sdk/pull/475) [`252a06d`](https://github.com/lifinance/sdk/commit/252a06de1db75fad3d8501e05cc128b0a4c9d914) Thanks [@chybisov](https://github.com/chybisov)! - Sign a caller-supplied Permit2 `PermitSingle` inline and send the swap as one ordinary user transaction. A custom swap provider can now attach a Permit2 message for its own spender — Uniswap's Universal Router, for example — to its quote step; the SDK signs it before `/advanced/stepTransaction`, which returns router calldata with the signature embedded. No relayer, no LI.FI Permit2 proxy, and no hand-rolled approve/relay/status steps.
  
  Execution routing no longer keys off the mere presence of `step.typedData`. One classifier assigns each entry to a lane — `native-permit` for EIP-2612, `permit2-allowance` for a Permit2 `PermitSingle` the user signs and then spends itself, and `relayer-message` for anything the LI.FI relayer submits — and each decision point reads the lane. Concretely:
  
  - A step whose only typed data is a Permit2 allowance executes as `standard` or `batched` instead of being force-routed to the relayer. That is the sole shape carved out: every other typed-data step — native permits, Order-based tools and gasless steps included — keeps the relayer route it already had.
  - `EthereumCheckBalanceTask` keeps the gas check for a Permit2 allowance step, because the user funds that transaction.
  - The token approval to Permit2 is unlimited when `estimate.approvalAddress` is the same contract every Permit2 allowance on the step names in `domain.verifyingContract`, so repeat swaps need a signature only. It stays at the swap amount otherwise, including when message signing is disabled and the allowance is therefore never signed.
  - `isRelayerStep` is removed. Use `isGaslessStep` to ask whether the relayer pays the gas. `isRelayerStep` only told you the step carried typed data, which no longer says how the step executes: a caller-supplied Permit2 allowance is signed inline and sent by the user. It had no callers left inside the SDK.
  - A step the API marks `executionType: 'message'` routes to the relayer even before its typed data arrives. The backend declares that at routes time while `typedData` only arrives at `/advanced/stepTransaction`, and in that window the SDK used to queue an approval into a batch the relayer then discarded. It is an additional signal, never a replacement: the gasless lane reports `executionType: 'transaction'` while being signature-only, so it still relies on the typed-data inference.
  - A step that carries typed data and receives no `transactionRequest` executes through the relayer. `batched` needs a transaction request and `standard` throws without one, so that is the only path a signature-only step can take. The strategy applies that test only after the step is prepared, because before prepare a Permit2 allowance that will receive a transaction and one that never will look identical — testing there would cost every batchable step its EIP-5792 batch.
  - The relayer never asks for a signature it already holds. An entry already in `signedTypedData` — a Permit2 allowance signed before prepare, for example — is relayed with that signature instead of being signed a second time, so a signature-only step raises one wallet prompt and not two.

### Patch Changes

- [#484](https://github.com/lifinance/sdk/pull/484) [`13c19c4`](https://github.com/lifinance/sdk/commit/13c19c4441341683b9dbaa8943e950b8f7571304) Thanks [@chybisov](https://github.com/chybisov)! - Refresh runtime dependencies: `@lifi/types` to `^18.10.0`, `viem` to `^2.56.8`,
  `@mysten/sui` to `^2.31.3`, `@solana/kit` to `^8.3.0`,
  `@solana/wallet-standard-features` to `^1.5.0`, `@stellar/stellar-sdk` to `^17.1.0`,
  `@bigmi/core` to `^0.9.2` and `tronweb` to `^6.5.1`.
- Updated dependencies [[`13c19c4`](https://github.com/lifinance/sdk/commit/13c19c4441341683b9dbaa8943e950b8f7571304), [`252a06d`](https://github.com/lifinance/sdk/commit/252a06de1db75fad3d8501e05cc128b0a4c9d914), [`252a06d`](https://github.com/lifinance/sdk/commit/252a06de1db75fad3d8501e05cc128b0a4c9d914)]:
  - @lifi/sdk@4.8.0

## 4.1.0

### Minor Changes

- [#471](https://github.com/lifinance/sdk/pull/471) [`a57b439`](https://github.com/lifinance/sdk/commit/a57b4391b52d9bc535577dcbfad1523ab4d2e32f) Thanks [@chybisov](https://github.com/chybisov)! - Add optional `SDKProvider.isTokenAddress`, so callers can validate a token identifier without knowing how each ecosystem shapes one: `C…` contract ids on Stellar, `0x…::module::TYPE` coin types on Sui, an address in any letter case on Ethereum, and the wallet format on Solana and Tron. `BitcoinProvider` omits the method, because the token list names its native coin `bitcoin` rather than giving it an address. A missing method means the ecosystem has no token address format, so a caller must not fall back to `isAddress`.

### Patch Changes

- Updated dependencies [[`d7d8abb`](https://github.com/lifinance/sdk/commit/d7d8abb776aa943aafda62d17926b8575f770478), [`a57b439`](https://github.com/lifinance/sdk/commit/a57b4391b52d9bc535577dcbfad1523ab4d2e32f)]:
  - @lifi/sdk@4.7.0

## 4.0.14

### Patch Changes

- [#467](https://github.com/lifinance/sdk/pull/467) [`a860598`](https://github.com/lifinance/sdk/commit/a86059887c77836089e360b886af4c379b978a35) Thanks [@chybisov](https://github.com/chybisov)! - Bump runtime dependencies: `viem` to 2.56.3, `@mysten/sui` to 2.28.0.

## 4.0.13

### Patch Changes

- [#459](https://github.com/lifinance/sdk/pull/459) [`954bc4b`](https://github.com/lifinance/sdk/commit/954bc4bda013b470102041810daf95cb4f9181a1) Thanks [@chybisov](https://github.com/chybisov)! - Bump runtime dependencies: `@lifi/types` to 18.4.0, `viem` to 2.56.0, `@mysten/sui` to 2.27.0.

- [#452](https://github.com/lifinance/sdk/pull/452) [`7cca666`](https://github.com/lifinance/sdk/commit/7cca666e20d14118d09a2f8141a77efcb42c465a) Thanks [@chmanie](https://github.com/chmanie)! - Fix native EIP-2612 permits failing for EIP-7702 delegated accounts. Tokens whose `permit` verifies through a `SignatureChecker` — Circle's USDC among them — branch on `owner.code.length` just as Permit2 does, so a delegated owner is verified via EIP-1271 and strict delegates reject the bare ECDSA signature with `EIP2612: invalid signature`. Delegated accounts are now probed with the same `isValidSignature` check already used for Permit2, rather than passed on the grounds that they can sign ECDSA. Other contract accounts remain excluded on shape, as before.
- Updated dependencies [[`954bc4b`](https://github.com/lifinance/sdk/commit/954bc4bda013b470102041810daf95cb4f9181a1)]:
  - @lifi/sdk@4.6.1

## 4.0.12

### Patch Changes

- Updated dependencies [[`b5ace9d`](https://github.com/lifinance/sdk/commit/b5ace9d9a2a0267ae4231b42035b55a0e1def72e)]:
  - @lifi/sdk@4.6.0

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
