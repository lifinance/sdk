---
'@lifi/sdk-provider-sui': patch
---

Use the `getJsonRpcFullnodeUrl` helper for the default Sui fullnode URL in SuiNS resolution instead of a hardcoded string. No behavior change — the helper returns the same mainnet endpoint.
