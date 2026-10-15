---
"@lifi/sdk-provider-ethereum": patch
---

An ERC-20 step can now get its spender from `/stepTransaction`. Some providers, such as Relay, only know the spender once they build the executable transaction, so the routing-time step carries no `estimate.approvalAddress`. Before, such a step skipped the allowance tasks, and its transaction went out against a spender with no allowance and reverted.

Now a new task runs after the transaction is prepared and before it is signed. When the step had no `approvalAddress` before prepare and the re-quote brings one, the task reads the allowance for it, and resets and sets it only if it falls short. In `batched`, the approval goes into the batch with the transaction.

On a chain with Permit2, the approval goes to the Permit2 contract, as it would before prepare.

A step that already had an `approvalAddress` before prepare behaves as before, even if the re-quote changes it. The task also does not run when the step skips approval.
