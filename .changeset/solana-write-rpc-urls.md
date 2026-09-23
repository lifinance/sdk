---
'@lifi/sdk-provider-solana': minor
---

Send transactions and Jito bundles through the chain's write RPCs when `rpcUrls[ChainId.SOL]` sets `write`. Transactions go to every write RPC; bundles go to the write RPCs that pass the Jito probe, and fall back to the Jito-capable read RPCs when none does. Reads, simulation and confirmation stay on the read RPCs; apart from one cached Jito probe per URL, a write RPC receives no reads. All confirmation branches share one send per resend interval, so each write RPC is sent to at most once a second, and a slow write RPC never holds up confirmation polling. Without a write list, nothing changes.
