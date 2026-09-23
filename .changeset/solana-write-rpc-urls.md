---
'@lifi/sdk-provider-solana': minor
---

Add `writeRpcUrls` to `SolanaProvider` options. Transactions and Jito bundles are sent through these RPCs, while reads, simulation and confirmation stay on the client's Solana `rpcUrls` — so a send-only endpoint never has to answer reads. Transactions go to every write RPC; bundles go to the write RPCs that pass the Jito probe, and fall back to the Jito-capable `rpcUrls` when none does. All confirmation branches share one send per resend interval, so each write RPC is sent to at most once a second. Unset or empty, nothing changes.
