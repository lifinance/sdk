# @lifi/sdk-provider-tron

## 4.1.3

### Patch Changes

- [#489](https://github.com/lifinance/sdk/pull/489) [`1a7c966`](https://github.com/lifinance/sdk/commit/1a7c96646e7a5696443b5a88485bdfb33b51682d) Thanks [@chybisov](https://github.com/chybisov)! - Keep concurrent balance reads for different wallets apart. The Solana, Sui and Tron balance actions deduplicate their RPC calls while in flight, but the dedupe ids did not include the wallet address, so two wallets read at the same time could both get the balances of whichever request started first. The ids now include the wallet address.
- Updated dependencies [[`1a7c966`](https://github.com/lifinance/sdk/commit/1a7c96646e7a5696443b5a88485bdfb33b51682d), [`b17e93e`](https://github.com/lifinance/sdk/commit/b17e93ebc3303e34913d41dba4b71a99897138b6)]:
  - @lifi/sdk@4.8.2

## 4.1.2

### Patch Changes

- Updated dependencies [[`621d410`](https://github.com/lifinance/sdk/commit/621d410db320188677df50f5ec5bf4a1c65bf818)]:
  - @lifi/sdk@4.8.1

## 4.1.1

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

- [#473](https://github.com/lifinance/sdk/pull/473) [`d7d8abb`](https://github.com/lifinance/sdk/commit/d7d8abb776aa943aafda62d17926b8575f770478) Thanks [@chybisov](https://github.com/chybisov)! - Bump runtime dependencies. `@lifi/sdk` moves `@lifi/types` to `^18.5.0`;
  `@lifi/sdk-provider-bitcoin` moves `@bigmi/core` to `^0.9.1` and `bitcoinjs-lib` to
  `^7.0.2`; `@lifi/sdk-provider-sui` moves `@mysten/sui` to `^2.29.0`; and
  `@lifi/sdk-provider-tron` moves `@tronweb3/tronwallet-abstract-adapter` to `^1.3.0`.
- Updated dependencies [[`d7d8abb`](https://github.com/lifinance/sdk/commit/d7d8abb776aa943aafda62d17926b8575f770478), [`a57b439`](https://github.com/lifinance/sdk/commit/a57b4391b52d9bc535577dcbfad1523ab4d2e32f)]:
  - @lifi/sdk@4.7.0

## 4.0.10

### Patch Changes

- [#469](https://github.com/lifinance/sdk/pull/469) [`5fd3b74`](https://github.com/lifinance/sdk/commit/5fd3b74f41f64da17c5869e8778b3bc4bd6e470c) Thanks [@chybisov](https://github.com/chybisov)! - Fix failed Tron transactions being reported as confirmed, which also left swap routes polling the status API forever. `waitForTronTxConfirmation` compared `receipt.result` to `FAILED`, a value Tron never emits there; it now checks the top-level `result` and the contract result, so a reverted or out-of-energy approval or swap throws `TransactionFailed` (or `InsufficientFunds` for `OUT_OF_ENERGY`) with the reason in the message.

## 4.0.9

### Patch Changes

- Updated dependencies [[`954bc4b`](https://github.com/lifinance/sdk/commit/954bc4bda013b470102041810daf95cb4f9181a1)]:
  - @lifi/sdk@4.6.1

## 4.0.8

### Patch Changes

- Updated dependencies [[`b5ace9d`](https://github.com/lifinance/sdk/commit/b5ace9d9a2a0267ae4231b42035b55a0e1def72e)]:
  - @lifi/sdk@4.6.0

## 4.0.7

### Patch Changes

- [#454](https://github.com/lifinance/sdk/pull/454) [`d86f36f`](https://github.com/lifinance/sdk/commit/d86f36f6c85d738a97ad8207e5e519fbefee7040) Thanks [@chybisov](https://github.com/chybisov)! - Bump runtime dependencies: `viem` to 2.55.19, `@mysten/sui` to 2.26.2, `tronweb` to 6.5.0.
- Updated dependencies [[`1ab67e5`](https://github.com/lifinance/sdk/commit/1ab67e5b5d89446a9c08530c6d9c296179e1a359)]:
  - @lifi/sdk@4.5.0

## 4.0.6

### Patch Changes

- Updated dependencies [[`fd1e9b5`](https://github.com/lifinance/sdk/commit/fd1e9b5ff481b35683d7b8557011c9c726446cdd)]:
  - @lifi/sdk@4.4.0

## 4.0.5

### Patch Changes

- Updated dependencies [[`d8b7adb`](https://github.com/lifinance/sdk/commit/d8b7adb6f797734f25d8c7d458121752a2567998), [`08b54da`](https://github.com/lifinance/sdk/commit/08b54dadebef063bc20af06630f0e43ec5850dca)]:
  - @lifi/sdk@4.3.0

## 4.0.4

### Patch Changes

- Updated dependencies [[`0990a5d`](https://github.com/lifinance/sdk/commit/0990a5d2dcb148c113e41aeeab38eb1bcc5c684e)]:
  - @lifi/sdk@4.2.0

## 4.0.3

### Patch Changes

- [#419](https://github.com/lifinance/sdk/pull/419) [`a3be034`](https://github.com/lifinance/sdk/commit/a3be034330f9815d462d526accece8f630c83345) Thanks [@chybisov](https://github.com/chybisov)! - Bump runtime dependencies: @mysten/sui to 2.20.1 and tronweb to 6.4.0.

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

- Updated dependencies []:
  - @lifi/sdk@4.0.0
