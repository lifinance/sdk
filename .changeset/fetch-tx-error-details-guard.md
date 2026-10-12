---
"@lifi/sdk": patch
---

`fetchTxErrorDetails` now checks its input before it calls Tenderly. If `txHash` is not a 32-byte hex hash, or `chainId` is not a positive safe integer, it returns `undefined` and sends no request.
