---
"@lifi/sdk": patch
---

A later step of a route now always gets a new transaction for the amount that arrived from the previous step. When the SDK sets the step amount from the previous step's status, it now always drops the transaction request of the step, also when the amount is the same. The prepare task then quotes the step again. Before this change, `executeRoute` on a stored route could sign a transaction request from an earlier run. A step with an open transaction still waits for that transaction and does not quote again.
