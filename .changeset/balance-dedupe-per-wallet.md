---
'@lifi/sdk-provider-solana': patch
'@lifi/sdk-provider-sui': patch
'@lifi/sdk-provider-tron': patch
---

Keep concurrent balance reads for different wallets apart. The Solana, Sui and Tron balance actions deduplicate their RPC calls while in flight, but the dedupe ids did not include the wallet address, so two wallets read at the same time could both get the balances of whichever request started first. The ids now include the wallet address.
