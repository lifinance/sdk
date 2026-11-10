---
"@lifi/sdk-provider-ethereum": patch
---

When the `switchChain` hook fails, the step now fails with `ChainSwitchError` and keeps the wallet error as `cause`. Before, the error went through unchanged and became `UnknownError` (for example, "Unknown Network: eip155:130" or "wallet_switchEthereumChain::chainId 0xe708 not supported"). A user rejection still goes through unchanged and keeps its current handling.
