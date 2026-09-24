---
'@lifi/sdk': minor
---

The `rpcUrls` option of `createClient` can split a chain's RPCs by role: `{ read?: string[]; write?: string[]; bundle?: string[] }` next to the existing plain list. Reads use `read` (unset: the chain's own RPCs); providers that broadcast transactions themselves send through `write` (unset: the read RPCs send too) and submit bundles through `bundle` (unset: the write, then the read RPCs that support bundles). `client.config.rpcUrls`, `getRpcUrls` and `getRpcUrlsByChainId` keep holding plain read lists; the new optional `client.getWriteRpcUrlsByChainId` and `client.getBundleRpcUrlsByChainId` return a chain's write and bundle lists, empty when it has none.
