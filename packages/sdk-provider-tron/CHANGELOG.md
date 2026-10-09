# @lifi/sdk-provider-tron

## 4.1.8

### Patch Changes

- Updated dependencies [[`5dc9cc5`](https://github.com/lifinance/sdk/commit/5dc9cc5f52b0308962b822cfacd766dbf27bab3c)]:
  - @lifi/sdk@4.12.0

## 4.1.7

### Patch Changes

- [#507](https://github.com/lifinance/sdk/pull/507) [`14f4ecc`](https://github.com/lifinance/sdk/commit/14f4ecc2714799449d57b61ff06b040df505184e) Thanks [@chybisov](https://github.com/chybisov)! - Resume a signed or broadcast transaction instead of signing again. The sign task checks the action again after the wallet returns: if a stopped run's transaction merged into it while the prompt was open, the step fails with `TransactionConflict` and the new signature is neither stored nor broadcast. The signed transaction is stored in `txHex` and rebroadcast after a reload; it is declared dropped only after `raw_data.expiration` (by block time), when the node does not find it within the lookup window and the LI.FI status API does not know it. A route stored without `txHex` has no `raw_data.expiration`; its transaction counts as expired about 5 minutes after `signedAt` (`isOldEnoughToDrop`, on the device clock), and it can be declared dropped only once the chain's block time is past `signedAt` plus the clock-skew and head margins, about 16 minutes after signing. A confirmation timeout is no longer treated as a final failure.

- [#509](https://github.com/lifinance/sdk/pull/509) [`34ecf9c`](https://github.com/lifinance/sdk/commit/34ecf9c4dcfa54cb2e60cacc931257fdc700c682) Thanks [@chybisov](https://github.com/chybisov)! - TRC-20 balance and allowance reads now use a static TRC-20 ABI instead of fetching the token contract from the node. This saves one request per read, stops TronWeb from keeping the ABI and bytecode of every token read (which grew memory without a limit), and makes the reads also work for a token whose on-chain ABI is empty or holds only a proxy's functions.
- Updated dependencies [[`bb964c0`](https://github.com/lifinance/sdk/commit/bb964c03d8ea1770303ab1bba803373a80e6388f), [`48af3ae`](https://github.com/lifinance/sdk/commit/48af3aeb250299ef9d2ff9eb79a38a6b8f52d409), [`14f4ecc`](https://github.com/lifinance/sdk/commit/14f4ecc2714799449d57b61ff06b040df505184e)]:
  - @lifi/sdk@4.11.0

## 4.1.6

### Patch Changes

- [#505](https://github.com/lifinance/sdk/pull/505) [`56f9913`](https://github.com/lifinance/sdk/commit/56f9913ccbc0508c94122baf3b7bbbcaa867d95b) Thanks [@chybisov](https://github.com/chybisov)! - Pick the first pipeline task by class reference instead of by class name. In builds that mangle class names, a step could start or resume at the wrong task — for example, an unneeded `approve()` before a native-token swap.

## 4.1.5

### Patch Changes

- Updated dependencies [[`dcbbdcc`](https://github.com/lifinance/sdk/commit/dcbbdccc2684c4549cbfe06444698f11347206af), [`2d60ab4`](https://github.com/lifinance/sdk/commit/2d60ab43af2ecd1c17a3bbb126de408952a46d80), [`2d60ab4`](https://github.com/lifinance/sdk/commit/2d60ab43af2ecd1c17a3bbb126de408952a46d80), [`2d60ab4`](https://github.com/lifinance/sdk/commit/2d60ab43af2ecd1c17a3bbb126de408952a46d80), [`2d60ab4`](https://github.com/lifinance/sdk/commit/2d60ab43af2ecd1c17a3bbb126de408952a46d80), [`2d60ab4`](https://github.com/lifinance/sdk/commit/2d60ab43af2ecd1c17a3bbb126de408952a46d80)]:
  - @lifi/sdk@4.10.0

## 4.1.4

### Patch Changes

- Updated dependencies [[`a65b003`](https://github.com/lifinance/sdk/commit/a65b00391698c3e8c2a1cd826bb0969c6977ecb6), [`9e815bd`](https://github.com/lifinance/sdk/commit/9e815bdd0d818b7e0866c78bdf48065185b64210), [`145f2b4`](https://github.com/lifinance/sdk/commit/145f2b49dbbc55776e0b0fe34b0b890f3e5be199)]:
  - @lifi/sdk@4.9.0

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
