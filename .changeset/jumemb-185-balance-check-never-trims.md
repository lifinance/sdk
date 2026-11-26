---
"@lifi/sdk": minor
---

The balance check no longer lowers the amount of a step. Before this change, a source-token gap within the step slippage made the SDK send the balance instead of the quoted amount. The slippage is the on-chain tolerance of the swap, so the user could receive up to twice the slippage less than quoted, with no prompt. Now any gap stops the step with "The balance is too low." and the real numbers, before anything is sent.

The time limit of the balance check goes from 10 to 15 seconds. When the limit ends, the balance check decides from the latest good balance read. A slow RPC no longer turns a small gap into "Could not read wallet balance".
