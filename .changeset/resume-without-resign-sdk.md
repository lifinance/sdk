---
"@lifi/sdk": minor
---

Never sign a second transaction on resume while the first one may still land. `prepareRestart` keeps a FAILED action with an unknown outcome and re-checks it on chain; only a final outcome (flagged with the new `ExecutionAction.txFinal`) is dropped so "Try again" signs anew. Adds `TransactionError`'s `final` option, `hasOpenTransaction`, `assertNoOpenTransaction`, `isKnownToStatusApi` and related helpers. `resumeRoute` no longer mutates the route it is given, and a restart keeps `execution.signedAt` while a transaction is open. Every `TransactionError` now has an own `final` property (`false` unless set), which changes its JSON shape.
