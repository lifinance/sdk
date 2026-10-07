---
'@lifi/sdk-provider-zcash': minor
---

New package. `ZcashProvider()` validates receivers on ZEC, a destination-only chain: transparent `t1` and `t3` addresses with a valid checksum, and unified `u1` addresses that decode under ZIP 316 and carry an Orchard receiver, the ones the API pays to a shielded balance. Sapling, TEX and testnet addresses, and a unified address without an Orchard receiver, are refused. It serves `ChainId.ZEC` beside `BitcoinProvider`, leaves balances unknown and cannot execute a step.
