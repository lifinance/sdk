---
"@lifi/sdk-provider-ethereum": patch
---

The balance check no longer lowers the amount of a step that has a signed EIP-2612 permit. The permit covers the exact amount, so a lower amount would revert on chain and cost gas. Such a step now fails with "The balance is too low." before the transaction is sent.
