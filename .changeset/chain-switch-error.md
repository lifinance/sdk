---
"@lifi/sdk-provider-ethereum": patch
---

When the `switchChain` hook fails, the step now fails with `ChainSwitchError` and keeps the wallet error as `cause`. Before, the error became `UnknownError` (for example, "Unknown Network: eip155:130" or "wallet_switchEthereumChain::chainId 0xe708 not supported"). The error message ends with the wallet's message. `parseEthereumErrors` applies its usual checks to the wallet error first, so a user rejection still gives `SignatureRejected`. A raw EIP-1193 error with code 4001 (for example, from a hook that calls the provider directly) now also gives `SignatureRejected`. If the hook throws an `SDKError`, the step fails with that same error.
