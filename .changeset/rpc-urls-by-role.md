---
'@lifi/sdk': minor
---

`rpcUrls` entries can split a chain's RPCs by role: `{ read?: string[]; write?: string[] }` next to the existing plain list. Reads use `read` (unset: the chain's own RPCs); providers that broadcast transactions themselves send through `write` (unset: the read RPCs send too). `getRpcUrls` and `getRpcUrlsByChainId` keep returning read URLs as plain lists, and the new `client.getWriteRpcUrlsByChainId` returns a chain's write list, empty when it has none.

`SDKBaseConfig.rpcUrls` is now typed `RPCUrlsConfig`. Code that passes plain lists is unaffected; code that reads `client.config.rpcUrls[chainId]` directly must handle the role form.
