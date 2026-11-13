---
"@lifi/sdk": minor
"@lifi/sdk-provider-ethereum": minor
---

Support the new LI.FI gasless flow, and stop calling the legacy gasless service.

Request a gasless route with `options.gasless: true`. The `LIFI Gasless Relay Fee` entry in `estimate.feeCosts` marks its step. The new `isGaslessStep(step)` in `@lifi/sdk` checks for this marker, and `GASLESS_RELAY_FEE_NAME` holds its name.

For a gasless step, the EVM provider now does the following:

- It executes the step through the relayer from the start.
- It does not check native gas, does not approve, and does not sign its own permit. The relayer pays the gas, and the backend handles the allowance.
- It re-quotes through `/advanced/stepTransaction` without the old typed data.
- It relays every typed-data step through `/advanced/relay`, including `PermitWitnessTransferFrom`.
- It tracks the relay on `/v1/status?taskId=`, with the same wait as other relayed steps. Other relayed steps keep `getRelayedTransactionStatus`. On a bridge route, the wait ends when the relayed source transaction has landed, so a bridge failure after that point does not cause a second signature. After a `FAILED` answer, the SDK reads the source receipt to find out if the source landed.
- It fails before signing when `disableMessageSigning` is set, or when the step needs an EIP-7702 authorization.

For all relayed steps, the wait now ends after five status errors in a row, not after three errors in total. A status answer resets the count. A failed request, `NOT_FOUND` and 422/1004 count as errors. The error is not final, so a resume waits for the same task and asks for no new signature.

Deprecated (still exported, so that published consumers keep building):

- `getRelayerQuote` in `@lifi/sdk` and in the client actions. The legacy relayer endpoint is shut down. Use `getRoutes` with `options.gasless: true`.
- `isGaslessStep(step, chain)` in `@lifi/sdk-provider-ethereum`. It detects only the legacy typed data. Use `isGaslessStep(step)` from `@lifi/sdk`.
