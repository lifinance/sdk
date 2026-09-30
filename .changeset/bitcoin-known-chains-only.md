---
'@lifi/sdk-provider-bitcoin': minor
---

`BitcoinProvider.isAddress(address, chainId)` refuses every UTXO chain other than BTC, so a Bitcoin address never passes as the receiver of a chain whose format the provider does not know; ZEC receivers are validated by `@lifi/sdk-provider-zcash`. `getBitcoinBalance` leaves the amount of a non-BTC token unknown instead of reporting the Bitcoin balance for it. `isBitcoinProvider` no longer matches another UTXO provider, such as `ZcashProvider`.
