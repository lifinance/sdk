---
"@lifi/sdk-provider-ethereum": patch
---

Mark reverted, cancelled, replaced and relayed-failed transactions as final so "Try again" signs a new transaction, while any other failure after broadcast is re-checked instead. The sign task refuses to sign while the step has an open transaction. The wait for a relayed transaction now ends after 24 hours (before, a task that stayed PENDING was polled every 5 seconds forever) and at once after `stopRouteExecution`; neither end is a final outcome, so the action keeps its task id and "Try again" waits for the same task instead of signing again.
