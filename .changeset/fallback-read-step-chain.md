---
"@lifi/sdk-provider-ethereum": patch
---

When a read through the wallet fails, the SDK reads again through a public client. That client now uses the step's chain, not `walletClient.chain`, which can be old. For `setTokenAllowance` and `revokeTokenApproval`, it uses the token's chain. This covers the allowance, permit, gas estimate and priority fee reads.
