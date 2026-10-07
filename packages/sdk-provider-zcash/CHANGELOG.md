# @lifi/sdk-provider-zcash

## 4.0.0

### Minor Changes

- [#492](https://github.com/lifinance/sdk/pull/492) [`48af3ae`](https://github.com/lifinance/sdk/commit/48af3aeb250299ef9d2ff9eb79a38a6b8f52d409) Thanks [@chybisov](https://github.com/chybisov)! - New package. `ZcashProvider()` validates receivers on ZEC, a destination-only chain: transparent `t1` and `t3` addresses with a valid checksum, and unified `u1` addresses that decode under ZIP 316 and carry an Orchard receiver, the ones the API pays to a shielded balance. Sapling, TEX and testnet addresses, and a unified address without an Orchard receiver, are refused. It serves `ChainId.ZEC` beside `BitcoinProvider`, leaves balances unknown and cannot execute a step.

### Patch Changes

- Updated dependencies [[`bb964c0`](https://github.com/lifinance/sdk/commit/bb964c03d8ea1770303ab1bba803373a80e6388f), [`48af3ae`](https://github.com/lifinance/sdk/commit/48af3aeb250299ef9d2ff9eb79a38a6b8f52d409), [`14f4ecc`](https://github.com/lifinance/sdk/commit/14f4ecc2714799449d57b61ff06b040df505184e)]:
  - @lifi/sdk@4.11.0
