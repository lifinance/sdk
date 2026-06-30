---
'@lifi/sdk': minor
---

Add optional limit-order fields (`toAmount`, `validUntil`, `partiallyFillable`) to `getRoutes` and to a step's `action` in `getStepTransaction`. The fields are passed through and resolved on the backend; classic calls are unchanged. Steps without an `estimate` no longer fail validation. New exported type: `LiFiStepRequest`.
