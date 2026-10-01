---
"@lifi/sdk-provider-tron": patch
---

Resume a signed or broadcast transaction instead of signing again. The signed transaction is stored in `txHex` and rebroadcast after a reload; it is declared dropped only after `raw_data.expiration` (by block time), when the node does not find it within the lookup window and the LI.FI status API does not know it. A confirmation timeout is no longer treated as a final failure.
