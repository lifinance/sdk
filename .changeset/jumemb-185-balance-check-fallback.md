---
"@lifi/sdk": patch
---

The balance check accepts a source-token gap of up to 0.5% when the step has no slippage. The API leaves out the step slippage when the slippage is on Auto. Before this change, any gap stopped a multi-step route with "The balance is too low."

The time limit of the balance check goes from 10 to 15 seconds. When the limit ends, the balance check now decides from the latest good balance read. A slow RPC no longer turns a small gap into "Could not read wallet balance".
