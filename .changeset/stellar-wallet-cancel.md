---
"@lifi/sdk-provider-stellar": patch
---

A Stellar wallet error with only the text "Transaction canceled" now gets the code `SignatureRejected` (1012), not `UnknownError` (1000). The same text is already mapped that way for Solana and Bitcoin.
