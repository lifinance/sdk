---
'@lifi/sdk': minor
'@lifi/sdk-provider-ethereum': minor
---

Add the unified funding orders surface: funding order types, `createFundingOrder`, `getFundingOrder`, `waitForFundingOrder`, the on-ramp/CEX helper actions, and `executeFundingOrder`/`resumeFundingOrder`, which run STANDARD orders through the existing route execution pipeline via `convertOrderToRoute`. Funding steps restore their committed quote from the order and track status against the order endpoint. HTTP 401 and 422 responses are now classified as `LiFiErrorCode.ValidationError` and `LiFiErrorCode.TransactionConflict` respectively across all endpoints (previously `InternalError`).
