---
'@lifi/sdk': patch
---

Fix `getQuote` dropping `distributionFees` (and other nested array/object params). `getQuote` built its GET query string with `URLSearchParams`, which stringifies an array of objects to `[object Object]`, so multi-recipient fee splits never reached the backend (which parses query params with `qs.parse(..., { comma: true })`). A new `toQueryString` util encodes nested params in qs indices notation (`distributionFees[0][receiver]=...`), so `distributionFees` now serializes correctly on `/quote` and `/quote/toAmount`. Scalar and scalar-array params are unchanged.
