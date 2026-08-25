---
'@lifi/sdk-provider-solana': minor
---

Bump `@solana/kit` from 7.1.0 to 8.0.0.

v8 removes the deprecated compute-unit-limit estimation helpers
(`estimateComputeUnitLimitFactory`, `estimateAndSetComputeUnitLimitFactory`,
`fillTransactionMessageProvisoryComputeUnitLimit`), `getBigIntDowncastRequestTransformer`,
the fixed transaction size constants (`TRANSACTION_PACKET_SIZE`,
`TRANSACTION_PACKET_HEADER`, `TRANSACTION_SIZE_LIMIT`), and several
`@solana/instruction-plans` result types, and it stops writing to the execution context in
`createTransactionPlanExecutor`. This package uses none of them, so no migration was
needed. `assertIsTransactionWithinSizeLimit` survives, and its threshold is now
transaction-version-aware rather than a single constant.

Minor rather than patch: no exported signature changes, but `@solana/kit` is a regular
dependency whose types reach this package's public surface — `toAddress` is re-exported
from it, and `SolanaProviderOptions.signedTransactions` is typed with its `Transaction`.
Integrators who also depend on `@solana/kit` directly must move to 8.x, or they will
resolve two copies whose types do not interchange.
