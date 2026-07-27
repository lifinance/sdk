---
'@lifi/sdk-provider-solana': patch
---

Fix Solana Jito bundle execution (EMB-462). The executor now routes by the shape of the backend's `transactionRequest.data` — an array is submitted via `sendBundle`, a string via `sendTransaction` — instead of inferring it from the signed-transaction count. The Jito-capable RPC probe now uses `getBundleStatuses` instead of `getTipAccounts`, so providers such as Helius (which support `sendBundle`/`getBundleStatuses` but not `getTipAccounts`) are correctly detected and bundles submit successfully.
