---
"@lifi/sdk": patch
---

Reject a negative decimal count in `parseUnits`. A negative count used to return a wrong integer, for example `1.5` at `-1` decimals returned `2`.
