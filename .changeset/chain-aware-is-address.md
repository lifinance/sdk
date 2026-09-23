---
'@lifi/sdk': minor
---

`SDKProvider.isAddress` accepts an optional `chainId`. Without it, a provider answers as before. With it, a provider whose chains use different address formats accepts only that chain's format and refuses a chain it does not know. A provider must never forward the chain ID to a library function whose second parameter means something else.
