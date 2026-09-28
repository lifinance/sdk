---
"@lifi/sdk-provider-ethereum": patch
---

`isZeroAddress` ignores case, so the checksummed `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` counts as a native token address.
