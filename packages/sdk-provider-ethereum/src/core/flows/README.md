# Execution-flow specs

End-to-end specs for the Ethereum step pipeline. Each file drives the real
`EthereumStepExecutor` through one shipped flow and pins what a consumer observes:
which API function was called, what was signed and in what order, what transaction
went where, which spender was approved for how much, and the action and status
sequence the widget renders.

They live together rather than beside a production file because no single file is
under test — `permit2Signature.flow.spec.ts` alone crosses the allowance tasks, the
Permit2 signer, the calldata encoder and the standard execute task. They also share
`harness.mock.ts`.

`*.flow.spec.ts` is a normal unit spec: fully mocked, no network. The repo's
`*.int.spec.ts` means something different — a real chain, skipped without a mnemonic.

## The one rule

**These pin what the code does, not what it should do.**

Three of them deliberately assert behaviour that looks wrong, each with a comment
saying so at the assertion:

- `EthereumRelayedSignAndExecuteTask` ignores `disableMessageSigning`.
- `SET_ALLOWANCE` reaches `DONE` before the batch carrying it is sent.
- `prepareRestart` leaves `step.typedData` holding the order the first attempt
  re-quoted into it, so the retry never re-obtains the permit it still needs.

If a change makes one of these fail, the fix is a decision, not an edit to the
expectation. Either the change is intended — update the spec and say why in the
commit — or it is a regression. Quietly adjusting the expected value to match new
behaviour turns the spec into a rubber stamp.

That rule is strongest while a behavioural refactor is in flight. Once the flows
here are settled, these are simply the pipeline's specs and are maintained like any
other.

## Adding one

Check every fixture lands in the lane its name claims. A `PermitSingle` whose
`message.spender` is `chain.permit2` is a relayer message, not a Permit2 allowance, and
the canonical Permit2 and LI.FI's Permit2Proxy are different addresses with
different roles. Getting that wrong has produced three specs in this package that
passed for the wrong reason.

Then prove the spec discriminates: break the line it claims to pin, watch it fail,
restore. A spec that survives that mutation pins nothing.
