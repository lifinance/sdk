---
"@lifi/sdk": minor
---

Remove the `getWalletBalances` action and client method — the underlying `/wallets/{address}/balances` API endpoint is deprecated. Use `getTokenBalances`/`getTokenBalancesByChain` to fetch balances directly from RPCs instead.
