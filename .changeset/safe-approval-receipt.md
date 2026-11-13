---
"@lifi/sdk-provider-ethereum": patch
---

The approval and approval reset steps now wait for the receipt of the transaction that the Safe executes, not of the Safe signature. Before, the steps did not check the receipt of a queued Safe approval.
