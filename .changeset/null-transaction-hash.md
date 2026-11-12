---
"@lifi/sdk-provider-ethereum": patch
---

Some wallets answer `eth_sendTransaction` with `null`, a value that is not hex, or a value shorter than a transaction hash. The approval, approval reset, swap and bridge steps now throw a `TransactionError` with `TransactionFailed` for this answer.
