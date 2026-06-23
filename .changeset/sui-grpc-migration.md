---
'@lifi/sdk-provider-sui': minor
---

Migrate the Sui integration off the deprecated JSON-RPC client (`SuiJsonRpcClient`) to the gRPC Core API (`SuiGrpcClient` / `client.core.*`) ahead of Sui's JSON-RPC sunset. Balance fetching (`listBalances`, now paginated), latest-checkpoint lookup (`ledgerService.getServiceInfo`), transaction confirmation (`core.waitForTransaction`), and SuiNS resolution (`nameService.lookupName`) now use gRPC. No public API changes.
