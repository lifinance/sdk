---
'@lifi/sdk': minor
---

Add `LiFiErrorCode.RpcUnavailable` (1027) for RPC endpoints that never return a usable response. Previously such failures were indistinguishable from a genuinely expired transaction.
