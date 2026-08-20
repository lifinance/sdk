---
'@lifi/sdk-provider-solana': patch
---

Fix `KeypairWalletAdapter`, which could not sign any real transaction.

`assertIsTransactionWithBlockhashLifetime` tested for a `lifetimeConstraint`
property that no `@solana/kit` decoder reconstructs, so every transaction was
rejected with `Transaction does not have a blockhash lifetime`. Signing never
needed it — the blockhash travels inside `messageBytes`.

The result then re-encoded the pre-signing object, discarding the signature,
because `partiallySignTransaction` returns a new transaction rather than
mutating its argument.

The adapter is test-only, so no production integration is affected.
