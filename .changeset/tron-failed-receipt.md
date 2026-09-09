---
"@lifi/sdk-provider-tron": patch
---

Fix failed Tron transactions being reported as confirmed. `waitForTronTxConfirmation` compared `receipt.result` to `FAILED`, a value Tron never emits there; it now checks the top-level `result` and the contract result, so a reverted or out-of-energy approval or swap throws `TransactionFailed` (or `InsufficientFunds` for `OUT_OF_ENERGY`) with the reason in the message.
