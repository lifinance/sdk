---
"@lifi/sdk-provider-ethereum": patch
---

All step sends now use one rule for the chain: the client's `chain` when it is the step's chain, and the step's chain from the LI.FI API when it is not, for example when `client.chain` is old or missing. The rule applies to the main transaction, batched calls, approvals and allowance resets. Before, the main transaction always used the chain from the API. That chain has no fee settings or serializers, so a local account (for example, a private key account) lost the fee rules of its chain, such as the base fee multiplier on HyperEVM.
