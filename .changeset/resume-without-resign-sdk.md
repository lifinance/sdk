---
"@lifi/sdk": minor
---

Never sign a second transaction on resume while the first one may still land.

- `prepareRestart` keeps a FAILED action with an unknown outcome and re-checks it on chain. Only a final outcome is dropped, so "Try again" signs anew.
- After `stopRouteExecution`, `updateRouteHook` can still be called for a route whose task was running, but only for a write that changes `txHash`, `txHex`, `taskId` or `txFinal`. An integrator that deleted the route should ignore that call. An error the hook throws in such a late call does not reach the run; in development it is logged with `console.debug`. If a new execution of the same route is running, a late transaction that may still land is merged into its action instead, so it does not sign again unless its wallet call has already started. If a newer execution already ended, the late transaction is merged into the route of the last ended execution, and that execution's `updateRouteHook` is called.
- The new `ExecutionAction.txFinal` flags a final outcome.
- `TransactionError` takes a new `final` option. Every `TransactionError` now has an own `final` property (`false` unless set), which changes its JSON shape.
- `resumeRoute` no longer mutates the route it is given. A restart keeps `execution.signedAt` while a transaction is open.
- In the EVM relayed lane and in the Solana, Sui, Tron, Bitcoin and Stellar providers, the SDK sends the transaction and checks the action again after the wallet returns. A prompt that was already open can still be signed, but when the late transaction merged first, those bytes are never sent or stored. A caught merge makes the newer run fail with `TransactionConflict`, and "Try again" then resumes and waits for the transaction. A step that asks for a replay (`ExecuteStepRetryError`) after such a merge also fails with `TransactionConflict`.
- An older run no longer stops or ends a newer execution of the same route.
- After `stopRouteExecution`, a run that waits for `/status` stops polling. Before, it polled every few seconds until the API answered DONE, and forever on FAILED, INVALID, NOT_FOUND or HTTP/network errors. The wait ends at once without a write to the route, so the step stays PENDING, and the run's `executeRoute` promise resolves with the route. A resume waits for the outcome of the same transaction.
- A stop during the first attempt of a step that then asks for a replay (`ExecuteStepRetryError`) also ends the run. The step does not run again, so the replay's re-quote, chain reads and integrator callbacks do not run after the stop, and `executeRoute` resolves with the route.
- `waitForResult` and `StepExecutor.executeStep` take an optional `signal`. Provider authors get it as `StepExecutorBaseContext.signal`, which aborts on `stopRouteExecution`. Give it only to a wait that starts after the transaction is broadcast, never to a sign, send or wallet call.
- New `hasOpenTransaction`. `assertNoOpenTransaction`, `isKnownToStatusApi`, `isFinalTransactionError`, `isResendAllowed`, `isOldEnoughToDrop`, `CLEARED_TRANSACTION_FIELDS`, `MAX_RESEND_AGE_MS`, `DROPPED_FALLBACK_AGE_MS` and `CLOCK_SKEW_MARGIN_MS` are exported for provider packages; they are not part of the integrator API (`@internal`).
- Remaining limits:
  - In the lanes where the SDK sends, if the newer prompt is approved before the older run stores its transaction (in the EVM relayed lane, before the older run's relay request returns), nothing is merged yet, and both transactions can be sent.
  - In the EVM standard and batched lanes the wallet sends, so a wallet call that has already started can still send a second transaction.
  - A FAILED route from before the upgrade, or one resumed after node history no longer covers its signing time, can stay unknown. The exit is to delete the route.
