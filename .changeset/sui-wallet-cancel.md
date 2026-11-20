---
"@lifi/sdk-provider-sui": patch
---

A Sui wallet error with the text "Transaction canceled" or a denial now maps to `SignatureRejected` (1012), not `UnknownError` (1000). The cancel text is already mapped that way for Solana, Bitcoin, and Stellar.
