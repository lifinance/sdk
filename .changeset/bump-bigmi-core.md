---
'@lifi/sdk-provider-bitcoin': patch
---

Require `@bigmi/core` 0.9.2, which reports a declined confirmation as a user rejection even when the wallet sends no rejection code. MetaMask's Bitcoin confirmation is one such wallet, so `parseBitcoinErrors` could not classify a cancelled signature and it surfaced as an unknown error.
