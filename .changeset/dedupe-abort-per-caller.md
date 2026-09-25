---
'@lifi/sdk': patch
---

A caller that aborts a deduplicated request no longer fails the other callers of that request. `getTokens` and `getChains` share an in-flight request between callers that ask the same query, and the shared request carried the first caller's signal, so when that caller aborted, every other caller got its `AbortError`. Now a caller that aborts leaves the shared request at once, and the request is aborted only when every caller has aborted. `withDedupe` takes an optional `signal` and passes its callback the signal to hand on to the request.
