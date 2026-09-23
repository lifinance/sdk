---
'@lifi/sdk-provider-bitcoin': minor
---

`BitcoinProvider.isAddress(address, ChainId.ZEC)` validates a Zcash receiver with its checksum. Transparent `t1` and `t3` addresses are accepted; TEX (`tex1`), Sapling (`zs1`) and unified (`u1`) addresses are recognised and refused until the API supports them. Any UTXO chain other than BTC and ZEC is refused, so a Bitcoin address no longer passes as the receiver of a chain whose format the provider does not know. `getBitcoinBalance` now leaves the amount of a non-BTC token unknown instead of reporting the Bitcoin balance for it.
