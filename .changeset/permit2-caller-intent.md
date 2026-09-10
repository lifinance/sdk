---
"@lifi/sdk-provider-ethereum": minor
---

Sign a caller-supplied Permit2 `PermitSingle` inline and send the swap as one ordinary user transaction. A custom swap provider can now attach a Permit2 message for its own spender — Uniswap's Universal Router, for example — to its quote step; the SDK signs it before `/advanced/stepTransaction`, which returns router calldata with the signature embedded. No relayer, no LI.FI Permit2 proxy, and no hand-rolled approve/relay/status steps.

Execution routing no longer keys off the mere presence of `step.typedData`. One classifier assigns each entry to a lane — native EIP-2612 permit, caller intent, or relayer intent — and each decision point reads the lane. Concretely:

- A step whose only typed data is a caller intent, or a native permit the transaction already carries, executes as `standard` or `batched` instead of being force-routed to the relayer. Order-based tools and gasless steps are unaffected.
- `EthereumCheckBalanceTask` keeps the gas check for a caller-intent step, because the user funds that transaction.
- The token approval to Permit2 is unlimited when `estimate.approvalAddress` is the same contract every caller intent on the step names in `domain.verifyingContract`, so repeat swaps need a signature only. It stays at the swap amount otherwise, including when message signing is disabled and the intent is therefore never signed.
- `isRelayerStep` keeps working and is unchanged, but it no longer answers a routing question. It only tells you the step carries typed data, and that no longer says how the step executes: a caller-supplied Permit2 intent is signed inline and sent by the user. Use `isGaslessStep` to ask whether the relayer pays the gas.
