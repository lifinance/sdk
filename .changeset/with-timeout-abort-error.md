---
"@lifi/sdk": patch
---

`withTimeout` now rejects with its timeout error only when its own timeout fires. Any other `AbortError` from the wrapped function passes through, so a wallet `AbortError` in the Bitcoin and Solana signing steps is no longer reported as `TransactionExpired`.
