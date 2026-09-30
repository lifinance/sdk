---
'@lifi/sdk-provider-zcash': minor
---

New package. `ZcashProvider()` validates receivers on ZEC, a destination-only chain: transparent `t1` and `t3` addresses with a valid checksum. It serves `ChainId.ZEC` beside `BitcoinProvider`, leaves balances unknown and cannot execute a step.
