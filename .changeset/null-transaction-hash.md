---
"@lifi/sdk-provider-ethereum": patch
---

The approval, approval reset and swap steps now throw a `TransactionError` with `TransactionFailed` when the wallet answers `eth_sendTransaction` with `null` or another value that is not a transaction hash. Before, they failed with `TypeError: Cannot read properties of null (reading 'startsWith')`.
