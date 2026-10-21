---
"@lifi/sdk-provider-tron": patch
---

A TRC-20 step can now get its spender from `/stepTransaction`. Some providers, such as Relay, only know the spender once they build the executable transaction, so the routing-time step carries no `estimate.approvalAddress`. Before, such a step skipped the allowance tasks, and its transaction went out against a spender with no allowance and reverted.

Now a new task runs after the transaction is prepared and before it is signed. When no allowance was checked before prepare and the re-quote brings an `approvalAddress`, the task reads the allowance for it and approves only if it falls short.

A step that already had an `approvalAddress` before prepare behaves as before, even if the re-quote changes it. The task also does not run for native TRX or when the step skips approval.
