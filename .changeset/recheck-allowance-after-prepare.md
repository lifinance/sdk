---
"@lifi/sdk-provider-ethereum": patch
---

An ERC-20 step whose `/stepTransaction` answer moved `estimate.approvalAddress` to another spender sent its transaction against a spender with no allowance, and the transaction reverted. The allowance tasks run before `/stepTransaction`, so they approved the spender of the routing-time step. Some providers, such as Relay, only know the spender once they build the executable transaction.

Now a new task runs after the transaction is prepared and before it is signed. When the spender changed, it reads the allowance for the new spender again, and resets and sets it only if it falls short. In `batched`, the approval queued for the old spender is dropped, so the batch approves only the new one. In `standard`, the approval to the old spender is already on-chain, so the user signs a second approval.

The task does not run when the spender is unchanged, when a signed native permit covers the allowance, when the step skips approval, or on the Permit2 lane, whose spender is `chain.permit2`.
