---
"@lifi/sdk-provider-solana": patch
"@lifi/sdk-provider-bitcoin": patch
---

A wallet error with only the text "Transaction canceled" now gets the code `SignatureRejected` (1012), not `UnknownError` (1000). Other rejections at the sign prompt get the same code. Apps can then show the rejection message and do not report the cancel as a failure.
