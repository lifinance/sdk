---
"@lifi/sdk-provider-ethereum": minor
---

Sign a caller-supplied Permit2 `PermitSingle` inline and send the swap as one ordinary user transaction. A custom swap provider can now attach a Permit2 message for its own spender — Uniswap's Universal Router, for example — to its quote step; the SDK signs it before `/advanced/stepTransaction`, which returns router calldata with the signature embedded. No relayer, no LI.FI Permit2 proxy, and no hand-rolled approve/relay/status steps.

Execution routing no longer keys off the mere presence of `step.typedData`. One classifier assigns each entry to a lane — native EIP-2612 permit, caller intent, or relayer intent — and each decision point reads the lane. Concretely:

- A step whose only typed data is a caller intent executes as `standard` or `batched` instead of being force-routed to the relayer. That is the sole shape carved out: every other typed-data step — native permits, Order-based tools and gasless steps included — keeps the relayer route it already had.
- `EthereumCheckBalanceTask` keeps the gas check for a caller-intent step, because the user funds that transaction.
- The token approval to Permit2 is unlimited when `estimate.approvalAddress` is the same contract every caller intent on the step names in `domain.verifyingContract`, so repeat swaps need a signature only. It stays at the swap amount otherwise, including when message signing is disabled and the intent is therefore never signed.
- `isRelayerStep` is removed. Use `isGaslessStep` to ask whether the relayer pays the gas. `isRelayerStep` only told you the step carried typed data, which no longer says how the step executes: a caller-supplied Permit2 intent is signed inline and sent by the user. It had no callers left inside the SDK.
- A step the API marks `executionType: 'message'` routes to the relayer even before its typed data arrives. The backend declares that at routes time while `typedData` only arrives at `/advanced/stepTransaction`, and in that window the SDK used to queue an approval into a batch the relayer then discarded. It is an additional signal, never a replacement: the gasless lane reports `executionType: 'transaction'` while being signature-only, so it still relies on the typed-data inference.
