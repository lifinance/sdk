---
"@lifi/sdk-provider-ethereum": patch
---

When a read through the wallet fails, the SDK reads again through a public client. That public client is now on the step's chain (or the token's chain for `setTokenAllowance` and `revokeTokenApproval`), not on `walletClient.chain`, which can be old. Before, an old `walletClient.chain` sent the allowance, permit, gas estimate and priority fee reads to another chain.
