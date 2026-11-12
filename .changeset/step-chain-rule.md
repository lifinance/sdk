---
"@lifi/sdk-provider-ethereum": patch
---

All sends now use one rule for the chain. When `client.chain` is the step's chain, the send keeps it. Otherwise the send uses the step's chain from the LI.FI API. This covers the main transaction, batched calls, approvals and allowance resets.

Before, the main transaction always used the API chain, which has no fee settings or serializers. So a local account lost the fee rules of its chain, for example the HyperEVM base fee multiplier. A matching `client.chain` now also keeps its custom fields and hooks, as viem does when no chain is given.

`setTokenAllowance` and `revokeTokenApproval` now send on the token's chain. An old `walletClient.chain` no longer makes them fail with `ChainMismatchError`.
