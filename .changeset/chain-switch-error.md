---
"@lifi/sdk-provider-ethereum": patch
---

When the wallet cannot switch to the step's chain, the step now fails with `ChainSwitchError`, not `UnknownError`. wagmi connectors throw viem's `SwitchChainError` for this, for example for "Unknown Network: eip155:130" or "wallet_switchEthereumChain::chainId 0xe708 not supported". `parseEthereumErrors` runs its rejection checks first, so a rejected switch still gives `SignatureRejected`. A raw EIP-1193 error with code 4001 now also gives `SignatureRejected`.
