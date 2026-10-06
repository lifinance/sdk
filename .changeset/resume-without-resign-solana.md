---
"@lifi/sdk-provider-solana": patch
---

Resume a signed or broadcast transaction instead of signing again. The signed transaction is stored in `txHex` and resent after a reload until it confirms or its blockhash expires (a durable-nonce transaction only within two minutes of signing); a transaction is declared dropped only when its blockhash expired, an RPC whose history covers the signing time does not find it, and the LI.FI status API does not know it. The sign task checks the action again after the wallet returns: if a stopped run's transaction merged into it while the prompt was open, the step fails with `TransactionConflict` and the new signature is neither stored nor sent. The wallet account is resolved only when signing. An expired blockhash after the SDK stopped waiting now reports `TransactionExpired` instead of `RpcUnavailable` when an RPC answered.
