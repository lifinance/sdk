---
"@lifi/sdk-provider-solana": patch
"@lifi/sdk-provider-bitcoin": patch
---

A wallet error with only the text "Transaction canceled" now gets the code `TransactionCanceled` (1010), not `UnknownError` (1000). Apps can then show a cancel message and do not report the error as a failure.
