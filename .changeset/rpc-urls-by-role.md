---
'@lifi/sdk': minor
---

The `rpcUrls` option of `createClient` can split a chain's RPCs by role: `{ read?: string[]; write?: string[]; bundle?: string[] }` next to the existing plain list. Reads use `read` (unset: the chain's own RPCs). `write` and `bundle` are dedicated send and bundle-submission RPCs; only `@lifi/sdk-provider-solana` uses them today, and other providers ignore them. `client.config.rpcUrls`, `getRpcUrls` and `getRpcUrlsByChainId` keep holding plain read lists; the new optional `client.getWriteRpcUrlsByChainId` and `client.getBundleRpcUrlsByChainId` return a chain's write and bundle lists, empty when it has none.

Plain lists work as before. At the type level, `SDKConfig['rpcUrls']` is now `RPCUrlsConfig`, so code that reads it back from a config object must narrow each entry with `Array.isArray`.
