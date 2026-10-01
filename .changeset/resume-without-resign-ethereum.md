---
"@lifi/sdk-provider-ethereum": patch
---

Mark reverted, cancelled, replaced and relayed-failed transactions as final so "Try again" signs a new transaction, while any other failure after broadcast is re-checked instead. The sign task refuses to sign while the step has an open transaction.
