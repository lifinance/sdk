---
"@lifi/sdk": patch
---

A later step of a route now always gets a new transaction. Before a later step runs, the SDK drops its transaction request, so the prepare task quotes the step again for the amount that arrived from the previous step. This also applies when the amount did not change, and when the previous step's status reported no received amount. Before this change, `executeRoute` on a stored route could sign a transaction request from an earlier run. A step with an open transaction still waits for that transaction and does not quote again.
