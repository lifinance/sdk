---
"@lifi/sdk-provider-ethereum": patch
---

A batched send (`wallet_sendCalls`) and an approval or allowance reset now name the step's chain. Before, viem took the chain from `client.chain`. A connector client (for example, from wagmi `getConnectorClient` with `assertChainId: false`) can keep a stale chain while the wallet is already on the step's chain. The wallet then rejected the bundle ("Chain ID must match the dApp selected network"), or viem stopped the approval with `ChainMismatchError`. `setAllowance` takes an optional `chain` as its last parameter.
