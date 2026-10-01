---
"@lifi/sdk-provider-solana": patch
---

Resume a signed or broadcast transaction instead of signing again. The signed transaction is stored in `txHex` and resent after a reload until it confirms or its blockhash expires (a durable-nonce transaction only within two minutes of signing); a transaction is declared dropped only when its blockhash expired, an RPC whose history covers the signing time does not find it, and the LI.FI status API does not know it. The wallet account is resolved only when signing. An expired blockhash after the SDK stopped waiting now reports `TransactionExpired` instead of `RpcUnavailable` when an RPC answered.
