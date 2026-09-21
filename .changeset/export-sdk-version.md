---
'@lifi/sdk': patch
---

Export `name` and `version` from the package entrypoint. The generated `src/version.ts` already carried the package name and the version that the SDK sends in its request headers and attaches to `SDKError`, but only internal modules could read them. Consumers can now import the same values instead of duplicating a hardcoded version string or reading `package.json` at runtime.
