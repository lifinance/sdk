---
"@lifi/sdk": patch
---

A later step of a route now always gets a new transaction for the amount that arrived from the previous step. When the SDK sets the step amount from the previous step's status, it drops a transaction request that was built for another amount. The prepare task then quotes the step again.
