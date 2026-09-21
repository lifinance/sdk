---
'@lifi/sdk': minor
---

Bump the `@lifi/types` pin to `^18.6.0`.

`18.6.0` adds `PermitSingle` to `TypedDataPrimaryTypes`, so the Ethereum
provider's typed-data lane classifier can compare `primaryType` against the
declared union instead of a module-private string allowlist.

`@lifi/sdk` re-exports `@lifi/types` wholesale, so the addition widens its own
public type surface — additive only, nothing is removed or narrowed.
