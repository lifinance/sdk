---
'@lifi/sdk-provider-solana': minor
---

Send transactions and Jito bundles through dedicated RPCs set by role in `rpcUrls[ChainId.SOL]`. Transactions go to the `write` RPCs. Bundles go to the `bundle` RPCs that pass the Jito probe, else to the Jito-capable `write` RPCs, else to the Jito-capable read RPCs as before. Reads, simulation and confirmation stay on the read RPCs; a write or bundle RPC receives no other reads than the Jito probe, which is cached per URL and repeated only after a failed probe's retry window. All confirmation branches share one send per resend interval, and a write RPC that has not answered its last send gets no new one, so each write RPC holds at most one open send and a slow one never holds up confirmation polling. Without write or bundle lists, nothing changes.
