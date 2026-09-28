---
"@lifi/sdk-provider-ethereum": patch
---

`isZeroAddress` ignores case, so it also matches the checksummed `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`.
