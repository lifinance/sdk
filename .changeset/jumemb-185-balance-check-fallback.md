---
"@lifi/sdk": patch
---

The balance check accepts a source-token gap of up to 0.5% when the step has no slippage. The API leaves out the step slippage when the slippage is on Auto. Before this change, any gap stopped a multi-step route with "The balance is too low." The fallback applies to every step without slippage, also to the first step of a route. On such a step, the SDK can now send up to 0.5% less than the quoted amount. When the balance check lowers the amount, it now also drops a transaction request from the quote. The SDK then builds a new transaction for the lower amount. A provider can turn off this trim with the new `allowAmountTrim: false` option of `CheckBalanceOptions`.

The time limit of the balance check goes from 10 to 15 seconds. When the limit ends, the balance check now decides from the latest good balance read. A slow RPC no longer turns a small gap into "Could not read wallet balance".
