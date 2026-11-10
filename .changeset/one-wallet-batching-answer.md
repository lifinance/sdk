---
"@lifi/sdk-provider-ethereum": patch
---

Read the wallet capabilities (EIP-5792) one time in each run of a step. Before, a late or failed read at prepare could move the step between `batched` and `standard` after its approval. Then the step failed with `TransactionUnprepared`, or it sent the swap without the correct approval. Now a step whose first read is late or fails stays in `standard`.
