---
"@lifi/sdk-provider-stellar": minor
"@lifi/sdk": minor
---

Account for the Stellar native reserve before spending XLM. `SDKProvider` gains an optional `getNativeReserve`, which the Stellar provider implements by reading the sender's account entry and computing `(2 + numSubEntries + numSponsoring - numSponsored) x baseReserve + sellingLiabilities`, plus one base reserve of headroom for the trustline `LiFi::internal_swap` opens on the sender's behalf (`try_trust`) inside the transaction being checked.

`checkBalance` now requires that reserve on top of the source amount, gas and non-included fees whenever a step spends the chain's native token, and preserves it when trimming the source amount by slippage. Previously a swap of nearly the whole XLM balance passed every pre-flight check and then failed in simulation with an opaque `HostError: Error(Contract, #10)` from the native Stellar Asset Contract; it now fails fast with a balance error naming the reserve, and the slippage rescue no longer proposes an amount that drains the account below it.
