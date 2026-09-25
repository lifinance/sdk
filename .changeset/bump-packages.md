---
'@lifi/sdk': minor
---

Bump the `@lifi/types` pin to `^18.12.1`. `@lifi/sdk` re-exports `@lifi/types`, so the new
`SlippageScope` and `RouteSlippageCommitment` types and the optional `slippageScope` and
`routeSlippage` fields become part of its public types. The change is additive only.
