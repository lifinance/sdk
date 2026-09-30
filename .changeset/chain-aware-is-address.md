---
'@lifi/sdk': minor
---

`SDKProvider.isAddress` accepts an optional `chainId`. Without it, a provider answers as before. With it, a provider whose chains use different address formats accepts only that chain's format and refuses a chain it does not know. A provider must never forward the chain ID to a library function whose second parameter means something else.

A provider can declare the `chainIds` it serves, so a chain-specific provider can sit beside the generic provider of the same chain type. `client.getProvider(type, chainId?)` returns the provider that lists the chain, otherwise the provider of that type that lists no chains; `getProvider(type)` answers as before. The new `findProvider(providers, chainType, chainId?)` applies the same rule to any provider list. `setProviders` replaces only a provider with the same type and the same `chainIds`.
