---
'@lifi/sdk': patch
---

Bump the `@lifi/types` pin from `^18.4.0` to `^18.6.0`.

`18.6.0` adds `PermitSingle` to `TypedDataPrimaryTypes`, so the Ethereum
provider's typed-data lane classifier can compare `primaryType` against the
declared union instead of a module-private string allowlist.
