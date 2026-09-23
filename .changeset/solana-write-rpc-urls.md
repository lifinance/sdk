---
'@lifi/sdk-provider-solana': minor
---

Send transactions and Jito bundles through the chain's write RPCs when `rpcUrls[ChainId.SOL]` sets `write`. Transactions go to the write RPCs; bundles go to the write RPCs that pass the Jito probe, and fall back to the Jito-capable read RPCs when none does. Reads, simulation and confirmation stay on the read RPCs; a write RPC receives no other reads than the Jito probe, which is cached per URL and repeated only after a failed probe's retry window. All confirmation branches share one send per resend interval, and a write RPC that has not answered its last send gets no new one, so each write RPC holds at most one open send and a slow one never holds up confirmation polling. Without a write list, nothing changes.
