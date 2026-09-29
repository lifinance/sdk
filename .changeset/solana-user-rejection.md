---
"@lifi/sdk-provider-solana": patch
---

A user rejection from a Wallet Standard wallet (code `4001`, or a message such as "User rejected the request") is now reported as `SignatureRejected` instead of `UnknownError`. An `AbortError` is not treated as a rejection.
