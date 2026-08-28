# @lifi/sdk-provider-bitcoin

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

- [#454](https://github.com/lifinance/sdk/pull/454) [`d86f36f`](https://github.com/lifinance/sdk/commit/d86f36f6c85d738a97ad8207e5e519fbefee7040) Thanks [@chybisov](https://github.com/chybisov)! - Bump `@bitcoinerlab/secp256k1` from 1.2.0 to 2.0.0.
  
  v2.0.0 moves to `@noble/curves` 2.3.0 and raises its own Node floor to 20.19; its API
  surface is unchanged. This package uses it in one place, passed to `bitcoinjs-lib`'s
  `initEccLib` for Taproot signing. It still passes that function's BIP340/341 verification
  vectors for `isXOnlyPoint` and `xOnlyPointAddTweak`, so P2TR behavior is unchanged.
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

- [#429](https://github.com/lifinance/sdk/pull/429) [`1de76f9`](https://github.com/lifinance/sdk/commit/1de76f93fcbdddc9df269581822036e4eecd3e78) Thanks [@chybisov](https://github.com/chybisov)! - Bump runtime dependencies: viem to 2.55.1 (ethereum), @bigmi/core to 0.9.0 (bitcoin), and @mysten/sui to 2.20.3 (sui).

## 4.0.2

### Patch Changes

- Updated dependencies [[`e8c8b69`](https://github.com/lifinance/sdk/commit/e8c8b6999ba8ffc127d47ba4a648d0a2792a4870), [`82b6c17`](https://github.com/lifinance/sdk/commit/82b6c17ceadfe3968e27e2c7bb3b8a1a0ded1840), [`2ced1e4`](https://github.com/lifinance/sdk/commit/2ced1e4881923ac14e110b3009150a5bd4f9d318), [`6e1b100`](https://github.com/lifinance/sdk/commit/6e1b1009700561571d0dca864f539129951c162b)]:
  - @lifi/sdk@4.1.0

## 4.0.1

### Patch Changes

- Updated dependencies [[`bf3d047`](https://github.com/lifinance/sdk/commit/bf3d047ebdc9a8b3a5a6362f65d25aa1eb652ffa)]:
  - @lifi/sdk@4.0.1

## 4.0.0

### Patch Changes

- [#398](https://github.com/lifinance/sdk/pull/398) [`e4e4600`](https://github.com/lifinance/sdk/commit/e4e460063aa22d672f1ea3fd26ffa9faf2655398) Thanks [@chybisov](https://github.com/chybisov)! - Bump @bigmi/core to 0.8.1.

- Updated dependencies []:
  - @lifi/sdk@4.0.0

## 4.0.0-beta.12

### Patch Changes

- [#398](https://github.com/lifinance/sdk/pull/398) [`e4e4600`](https://github.com/lifinance/sdk/commit/e4e460063aa22d672f1ea3fd26ffa9faf2655398) Thanks [@chybisov](https://github.com/chybisov)! - Bump @bigmi/core to 0.8.1.
