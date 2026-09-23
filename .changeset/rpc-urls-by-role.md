---
'@lifi/sdk': minor
---

The `rpcUrls` option of `createClient` can split a chain's RPCs by role: `{ read?: string[]; write?: string[] }` next to the existing plain list. Reads use `read` (unset: the chain's own RPCs); providers that broadcast transactions themselves send through `write` (unset: the read RPCs send too). `client.config.rpcUrls`, `getRpcUrls` and `getRpcUrlsByChainId` keep holding plain read lists, and the new optional `client.getWriteRpcUrlsByChainId` returns a chain's write list, empty when it has none.
