---
'@lifi/sdk-provider-ethereum': patch
---

`EthereumProvider.isAddress` no longer passes a second argument to viem's `isAddress`, whose second parameter is `options`. Results are unchanged.
