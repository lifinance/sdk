---
"@lifi/sdk": patch
---

`waitForResult` returns a falsy result such as `0` or `false` instead of polling forever, and `maxRetries: 0` now throws on the first error.
