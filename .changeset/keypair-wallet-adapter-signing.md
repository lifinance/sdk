---
'@lifi/sdk-provider-solana': patch
---

Fix `KeypairWalletAdapter`, which could not sign any real transaction.

Two defects, each independently fatal. `assertIsTransactionWithBlockhashLifetime`
tested for a `lifetimeConstraint` property that no `@solana/kit` decoder
reconstructs — decoding wire bytes yields `messageBytes` and `signatures` alone
— so every transaction a wallet is handed was rejected with
`SolanaError: Transaction does not have a blockhash lifetime`. Signing never
needed that property: `partiallySignTransaction` signs `messageBytes`, and the
blockhash still travels inside those bytes.

The signed result then re-encoded the pre-signing object.
`partiallySignTransaction` returns a new frozen transaction rather than mutating
its argument, so the signature was discarded and the wire bytes carried the
unsigned placeholder.

The adapter is documented as test-only, so no production integration is
affected; real wallets implement `signTransaction` themselves. It is what the
SDK's own examples and integration tests use, which is where this surfaced.
