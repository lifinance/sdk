# Funding Orders — Post-Review Fix Design

- **Date:** 2026-08-12
- **Status:** Approved design, pre-implementation
- **Branch:** `feat/funding-orders-integration`
- **Repos affected:** `sdk` (this repo) only. The `widget` follow-up is out of scope — see §9.
- **Predecessors:** `docs/funding-orders/specs/2026-08-11-funding-orders-sdk-widget-integration-design.md` (the original design) and `docs/funding-orders/plans/2026-08-11-funding-orders-sdk.md` (the implementation plan, all 10 tasks committed).
- **Backend contract:** `lifi-backend` branch `funding-orders` (read-only dependency).

## 1. Background

All 10 tasks of the funding orders implementation plan are committed on this branch, and the
`@lifi/sdk` unit suite passes (278 tests). A high-effort code review then produced 15 findings.
None of them sits in a path the suite exercises.

The findings are not defects against the plan. The plan was implemented faithfully. Most of the
findings are gaps the plan never had a task for, plus two places where the committed code
contradicts a claim the original spec already makes. That distinction drives the structure below:
§3 lists what changed in the review's conclusions after verification against the backend, §4
records the four design decisions taken, and §5–§8 specify the work.

Two facts were verified directly in `lifi-backend` on branch `funding-orders`, because the review
could not check them. They decide two findings:

- `apps/backend-api/src/packages/FundingOrders/fundingOrders.quote.ts:31` throws
  `gasless is not supported for funding orders`.
- `apps/backend-api/src/services/routing/routing.executionTypes.ts:37` sets
  `skipPermit: skipPermit ?? false`. Only the hyperliquid tools and protocols set it `true`.

## 2. Goals and non-goals

**Goals**

- Remove every path where a funding order can take the user's funds twice, or revert after the
  user has signed.
- Give `executeFundingOrder` and `resumeFundingOrder` one completion contract across all four
  funding sources, as the original spec §6.4 requires.
- Freeze the public funding types in their final shape before release, so no later fix needs a
  major bump.
- Keep `@lifi/sdk-provider-ethereum` free of new funding coupling.

**Non-goals**

- No change to the backend contract. Every fix works against the API as it exists.
- No widget work. See §9.
- No re-litigation of the original design. `convertOrderToRoute`, the funding step marker, and
  the two-slot pipeline hook all stay.

## 3. Corrections to the review

### 3.1 Closed — the relayer and permit-typed-data concern

The review's finding 4 claims `getEthereumExecutionStrategy` and `EthereumCheckPermitsTask` stay
funding-blind, so a funding step could take the relayer path.

The backend rejects `options.gasless` for funding orders, so a funding quote carries no
`typedData`. `isRelayerStep` is `!!step.typedData?.length`, so it returns `false`, and
`getEthereumExecutionStrategy` never returns `'relayed'`. `EthereumCheckPermitsTask` gates on
`primaryType === 'Permit'`, which also requires `typedData`. The backend contract guards both
call sites. No change needed.

### 3.2 Downgraded — the prepare-slot divergence

The review's finding 5 warns that `stepComparison` can prompt for an exchange-rate update on a
committed funding quote. `getFundingOrderUpdatedStep` reads the quote back from the order, and the
backend stores that quote at order creation, so the comparison runs against identical numbers and
no prompt fires. The real costs are a redundant `GET /funding/orders/{id}` on every prepare, retry
and resume, and the divergence between the two prepare slots. It is an efficiency and consistency
issue, not a correctness one, and §8 still fixes it.

### 3.3 Confirmed live — the discarded permit

The review's finding 1 is real, and the original spec is wrong about it. Spec §89 states "There is
no permit/typed-data path — the backend rejects `options.gasless` for funding orders." Native
permit is not the gasless path. `EthereumNativePermitTask.shouldRun` gates on
`permit2Proxy && !batched && !disableMessageSigning && !step.estimate.skipPermit`, none of which is
funding-aware, and the backend leaves `skipPermit` at `false` for funding quotes.

The failure needs an ERC-20 source token, a chain with `permit2Proxy`, a wallet without EIP-5792
batching, and no existing allowance:

1. `EthereumNativePermitTask` prompts the user, signs the permit, and sets `hasMatchingPermit`.
2. `EthereumSetAllowanceTask.shouldRun` is then `false`, so no approval transaction is sent.
3. `getUpdatedStep` takes its funding branch, which ignores `signedTypedData`, and returns the
   order's committed `transactionRequest`. That request targets `estimate.approvalAddress`, not
   `permit2Proxy`, and carries no permit calldata.
4. The send reverts with `ERC20: insufficient allowance`, after the user has already signed.

`isPermit2Supported` contains `strategy !== 'batched'`, so an EIP-5792 wallet is already safe. The
bug hits non-batching wallets.

### 3.4 Reachability of the chain-check guard

The review's finding 7 is real, and its cause is broader than the review states.
`EthereumWaitForTransactionStatusTask.ts:19-27` runs its chain check **before** it delegates at
line 29. On re-entry the RECEIVING_CHAIN action already exists, and an action with
`substatus: undefined` also fails the `!== 'WAIT_DESTINATION_TRANSACTION'` test. The guard
therefore trips whether or not the funding substatus is written. It affects cross-chain funding
orders only; a same-chain order has `actionType === 'SWAP'` and creates no RECEIVING_CHAIN action.

## 4. Decisions

| # | Decision | Rejected alternative |
|---|---|---|
| D1 | A resolve from `executeFundingOrder` or `resumeFundingOrder` always means the order is terminal, DONE or FAILED. The caller branches on `order.status`. Anything short of terminal rejects. | Reject on FAILED in both branches; or keep today's asymmetry. |
| D2 | Resume guards against a double send in two layers: `getActiveRoute(orderId)` first, then an optional `sourceTxHash` the caller supplies. | Accept a persisted `RouteExtended`, which reverses the original spec §137 persistence decision. |
| D3 | The funding permit gate is `estimate.skipPermit = true`, set in `@lifi/sdk`. | Add `isFundingOrderStep` to the Ethereum permit call sites. |
| D4 | The funding wait slot writes the `WAIT_DESTINATION_TRANSACTION` sentinel. The open-string funding substatus reaches the caller through `onOrderUpdate` only. | Short-circuit `EthereumWaitForTransactionStatusTask` on `isFundingOrderStep`. |

D3 and D4 both keep `@lifi/sdk-provider-ethereum` free of new funding coupling.

## 5. Funding step construction

Findings 1, 13, 15.

### 5.1 `convertOrderToRoute` clones before it marks

`convertQuoteToRoute` builds `steps: [quote]` with no clone, so `route.steps[0] === order.quote`.
Writing the markers directly therefore pollutes the caller's `FundingOrder`. The clone is required,
not cosmetic, because D3 adds a second written field.

```ts
const route = convertQuoteToRoute(structuredClone(order.quote))
route.id = order.orderId
const step = route.steps[0] as LiFiStepExtended
step.fundingOrderId = order.orderId
step.estimate.skipPermit = true
```

### 5.2 `getFundingOrderUpdatedStep` sets the same marker

The refresh path returns a step built from a freshly read `order.quote`. It sets `skipPermit` on a
copied estimate, so a refresh cannot re-open the permit path and the spread stays free of shared
sub-objects:

```ts
return {
  ...order.quote,
  estimate: { ...order.quote.estimate, skipPermit: true },
  id: step.id,
  fundingOrderId: step.fundingOrderId,
  execution: step.execution,
}
```

### 5.3 Why `skipPermit` is the right switch

`skipPermit` already exists for exactly this meaning. `isPermit2Supported` reads it, and
`EthereumCheckAllowanceTask`, `EthereumSetAllowanceTask`, `EthereumResetAllowanceTask` and
`EthereumStandardSignAndExecuteTask` all consult that helper. `EthereumNativePermitTask` reads it
directly. Two lines in `@lifi/sdk` therefore close the whole permit2 path, and the Ethereum
provider needs no funding awareness.

A funding order can never use permit: its `transactionRequest` is committed at order creation and
targets `estimate.approvalAddress`. Batching is unaffected and stays desirable — EIP-5792 sends
the approval and the funding transaction atomically, which works with a committed request.

### 5.4 `isFundingOrderStep` narrows

```ts
export function isFundingOrderStep(
  step: LiFiStep | LiFiStepExtended
): step is LiFiStepExtended & { fundingOrderId: string }
```

`WaitForFundingOrderTask` then drops the `step.fundingOrderId!` assertion, and imports
`FundingExecutionOptions` instead of re-declaring that shape inline as an `as` cast. A type-only
import creates no runtime cycle.

## 6. Completion contract

Findings 6, 10, 14. Decision D1.

**The rule: a resolve means the order is terminal. Nothing else resolves.**

### 6.1 `WaitForFundingOrderTask` stops throwing on FAILED

On a FAILED order the task marks the action and the execution FAILED, then returns `COMPLETED`.
The route state stays truthful for the UI, and the pipeline unwinds normally instead of through
the error path.

This is safe, and the mechanism is worth recording so it is not re-derived later:

- `TaskStatus` is `'COMPLETED' | 'PAUSED'` only, so a task signals failure solely by throwing.
- `BaseStepExecutor.executeStep` sets no status on its success path, so nothing overwrites the
  FAILED mark.
- `executeSteps` then reaches `if (executedStep.execution?.status !== 'DONE') { stopRouteExecution(route) }`
  and returns the route. A FAILED step therefore stops the route and resolves it.

The same path carries the §6.2 timeout: the pipeline returns `PAUSED`, the execution stays PENDING,
`stopRouteExecution` runs, and the route resolves. In both cases `executeRoute` resolves, and §6.3
decides what the caller receives.

### 6.2 A poll timeout returns PAUSED

On a timeout the task returns `PAUSED` and leaves the execution PENDING. This is what the original
spec §157 asks for: the order stays PENDING and the resume path stays alive. Today the throw
reaches `BaseStepExecutor`, whose catch marks the execution FAILED.

### 6.3 The caller-facing functions capture the terminal order

Both functions wrap `options.onOrderUpdate` with an internal capture that chains to the caller's
callback. `waitForFundingOrder` fires `onUpdate` on the terminal transition too, so the terminal
order arrives without a second HTTP read. That removes the redundant `getFundingOrder` at
`fundingExecution.ts:67`.

```ts
let latest: FundingOrder | undefined
const capture = (o: FundingOrder) => {
  latest = o
  options?.onOrderUpdate?.(o)
}
// ... run executeRoute / resumeRoute with onOrderUpdate: capture
if (latest && latest.status !== 'PENDING') {
  return latest
}
const refetched = await getFundingOrder(client, orderId, {
  integrator: options?.integrator,
})
if (refetched.status !== 'PENDING') {
  return refetched
}
throw new SDKError(
  new TransactionError(
    LiFiErrorCode.Timeout,
    `Funding order ${orderId} execution stopped before a terminal state. Resume it.`
  )
)
```

The single read covers the case where no transition ever fired. A still-PENDING order means the
execution stopped early — a timeout, a `PAUSED` task under `executeInBackground`, or
`stopRouteExecution`. All three mean the same thing to the caller: resume later. One error type,
one recovery action.

### 6.4 Resulting contract

Identical for STANDARD, SMART_DEPOSIT and ONRAMP, and for both entry points:

- **Resolves** with a DONE or FAILED `FundingOrder`. The caller branches on `order.status`.
- **Rejects** on a stop before terminal (`LiFiErrorCode.Timeout`), on a transport error, and on
  the existing FAILED-input `ValidationError` from `executeFundingOrder`.

## 7. Resume path and the wait slot

Findings 2, 3, 7, 11, 12, and the `AbortSignal` gap (finding 9). Decisions D2 and D4.

### 7.1 Three ordered resume layers

```ts
const fresh = await getFundingOrder(client, order.orderId, {
  integrator: options?.integrator,
})
if (fresh.status !== 'PENDING') {
  return fresh
}

// Layer 2: a live in-memory route wins - provider resume-slicing works on it
const live = getActiveRoute(fresh.orderId)
if (live) {
  return resumeAndCapture(client, live, options)
}

// Layer 3: a source transaction exists -> never re-send
const sourceTxHash = fresh.result?.fromTxHash ?? options?.sourceTxHash
if (fresh.type !== 'STANDARD' || sourceTxHash) {
  return waitOnly(client, fresh, options, sourceTxHash)
}

// Layer 4: nothing sent yet -> rebuild and resume
return executeAndCapture(client, convertOrderToRoute(fresh), options)
```

`resumeAndCapture` and `executeAndCapture` are the §6.3 capture wrappers around `resumeRoute` and
`executeRoute`. Both entry points share them, so the §6.4 contract holds on every layer.

Layers are numbered to match the `resumeFundingOrder` JSDoc: 1 is the terminal-order early
return, 2 the live route, 3 the already-sent guard, 4 the rebuild. Use these numbers everywhere.

**Layer 2 is much narrower than it looks, and the implementation proved it.** `getActiveRoute`
reads `executionState`, and `stopRouteExecution` deletes that entry (`execution.ts:222`).
`executeSteps` calls `stopRouteExecution` on *every* non-DONE step outcome (`execution.ts:157`),
including the §6.2 `PAUSED` timeout. So layer 2 does **not** cover a resume after a pause, a
background/foreground transition, or a retry — in all of those the state is already gone and
`getActiveRoute` returns `undefined`. What it does cover is a resume issued while an execution is
still live in `executionState`, i.e. a duplicate or concurrent resume call; `resumeRoute` then
attaches to the running execution rather than starting a second one.

**Consequence: layer 3 carries the guard almost alone.** Since layer 2 rarely applies, the
protection against a double send is `options.sourceTxHash` plus the order's own
`result.fromTxHash`. A caller that does not persist `sourceTxHash` is unguarded for exactly the
window this design set out to close — the interval between broadcast and backend attribution.
That makes the widget change in §9 a requirement, not an enhancement.

Layer 3 closes the attribution window. The backend sets `result.fromTxHash` only after it sees the
transfer, so the order-derived guard alone leaves the interval between broadcast and attribution
unprotected. `sourceTxHash` is a new optional field on `FundingExecutionOptions`; the caller stores
it beside the orderId in its thin list. That costs one field and keeps the original spec §137
decision ("the order response is the schema") intact.

Layer 2 is nevertheless the strongest guard where it applies, but not for the reason first
assumed. It does not restore provider resume-slicing: `stopRouteExecution` sets
`allowExecution: false` at `execution.ts:219` and deletes the state entry at `:222`, while
`updateRouteExecution` resets the flag through `defaultInteractionSettings` — so `executionHalted`
(`execution.ts:62-64`) can never be true while an entry exists, and `prepareRestart` is unreachable
on that path. What layer 2 does is attach to the running execution instead of starting a second
one, which is why a duplicate resume cannot double-send.

### 7.2 The sentinel substatus

The wait slot writes `substatus: 'WAIT_DESTINATION_TRANSACTION'` on the action. A normal bridge
carries that value while it waits, so `EthereumWaitForTransactionStatusTask`'s chain check skips the
funding step on re-entry, exactly as it does for a normal bridge. Both `as any` casts disappear,
because the open-string funding substatus no longer touches `ExecutionAction.substatus`. It reaches
the caller through `onOrderUpdate`.

`initializeAction` cannot carry the value. Its `ActionProps` destructure at
`statusManager.ts:136-141` accepts `step`, `type`, `chainId` and `status` only. The sentinel
therefore goes on in a separate call, immediately after the action exists and before anything can
re-enter:

```ts
const action = statusManager.initializeAction({
  step,
  type: this.actionType,
  chainId: /* ... */,
  status: 'PENDING',
})
statusManager.updateAction(step, action.type, 'PENDING', {
  substatus: 'WAIT_DESTINATION_TRANSACTION',
})
```

Do not extend `ActionProps` for this. `initializeAction` reuses an existing action by calling
`updateAction(step, type, status, { error: undefined })`, which leaves an earlier substatus in
place, so the explicit call is what makes the sentinel correct on both first entry and re-entry.

### 7.3 The terminal update guards its optional fields

`statusManager.ts:207` ends in `Object.assign(currentAction, rest)`, and `Object.assign` copies an
explicit `undefined`. A DONE order carrying only `fromTxHash` therefore erases the source hash from
the SWAP action on a same-chain order — losing the explorer link and re-arming the double send of
§7.1, because `prepareRestart` then finds no action with a `txHash`.

```ts
statusManager.updateAction(step, action.type, 'DONE', {
  chainId: step.action.toChainId,
  ...(order.result?.toTxHash && {
    txHash: order.result.toTxHash,
    txLink: `${toChain.metamask.blockExplorerUrls[0]}tx/${order.result.toTxHash}`,
  }),
})
```

### 7.4 The source transaction is reported until it lands

`waitForFundingOrder` takes `txHash` and sends it on every non-terminal poll until the order
reports `result.fromTxHash`. The backend accepts `?txHash=` on a STANDARD non-terminal order, so a
repeat is in contract.

`WaitForFundingOrderTask` keeps reading the source hash from the source action, exactly as it does
today, and now forwards it into the wait instead of reporting it once:

```ts
const sourceAction = statusManager.findAction(
  step,
  isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
)
// ...
const order = await waitForFundingOrder(client, orderId, {
  txHash: sourceAction?.txHash,
  // ... interval, timeout, integrator, signal, onUpdate
})
```

The separate pre-flight `getFundingOrder(client, orderId, { txHash }).catch(() => undefined)` goes
away, so a single transient failure can no longer strand the order at PENDING until the timeout.

### 7.5 New option fields

`WaitForFundingOrderOptions` gains:

- `txHash?: string` — reported on every non-terminal poll (§7.4).
- `integrator?: string` — scopes every poll. Without it a keyless `partnerOrderId` wait rejects
  at once, because 401 and 404 are on the immediate-reject list.
- `signal?: AbortSignal` — `getFundingOrder` already accepts `RequestOptions`, so the signal
  threads through unchanged.

`FundingExecutionOptions` gains `sourceTxHash?: string`, `integrator?: string` and
`signal?: AbortSignal`, and forwards all three.

`sleep` gains an abortable form so a 20-minute wait cancels between polls rather than at the next
request. Without it, a page that unmounts a SMART_DEPOSIT QR keeps polling and keeps calling
`onOrderUpdate`; `stopRouteExecution` does not exist for the non-STANDARD path at all.

## 8. Ethereum prepare slot and the 422 code

Findings 5 and 8.

### 8.1 The prepare slots converge

`EthereumPrepareTransactionTask` takes the shape the core `PrepareTransactionTask` already has:

```ts
if (isFundingOrderStep(step)) {
  if (!step.transactionRequest) {
    Object.assign(step, await getFundingOrderUpdatedStep(client, step), {
      execution: step.execution,
    })
  }
} else {
  const updatedStep = await getUpdatedStep(
    client,
    step,
    executionOptions,
    signedTypedData
  )
  const comparedStep = await stepComparison(
    statusManager,
    step,
    updatedStep,
    allowUserInteraction,
    executionOptions
  )
  Object.assign(step, {
    ...comparedStep,
    execution: step.execution,
    typedData: updatedStep.typedData ?? step.typedData,
  })
}
```

The funding branch then leaves `getUpdatedStep` entirely. Two gains follow. `getUpdatedStep` again
handles only re-quotable steps, so it can never drop `signedTypedData` — which removes the §3.3
root cause at its source rather than only gating the permit task. And the provider holds one
funding branch instead of two.

The 57-line `getUpdatedStep.unit.spec.ts` funding case moves to
`EthereumPrepareTransactionTask.unit.spec.ts`, where the behaviour now lives.

### 8.2 The 422 classification

This reverses a deliberate choice. Plan Task 2 ("HTTP error classification for 401 and 422"),
committed as `7d675607`, picked `TransactionConflict` on purpose, to carry the idempotency-conflict
meaning of a 422 from `POST /v1/funding/orders`. The intent was right; the mechanism was too broad,
because `statusCodeToErrorClassificationMap` applies to every endpoint and the code was already
taken.

The global map entry returns to `{ ErrorName.ValidationError, LiFiErrorCode.ValidationError }`,
matching 400 and 401. `createFundingOrder` translates a 422 into a funding-specific
`ValidationError` whose message names `partnerOrderId` reuse. The idempotency meaning survives at
the one endpoint that has it.

`parseBitcoinErrors` already produces `LiFiErrorCode.TransactionConflict` (1020) for a real
mempool conflict. Mapping every 422 on every endpoint to 1020 collides with that meaning, and a
consumer switching on 1020 would show "transaction conflict" copy for an unrelated validation
failure. Funding semantics belong at the funding action.

## 9. Out of scope — the widget follow-up

Two widget changes follow from this design and belong in a separate spec in the `widget` repo.
**The first is required, not optional** — see the consequence note in §7.1. Without it the
double-send window this design set out to close stays open, because layer 2 almost never applies.

- The thin localStorage list of the original spec §137 needs a `sourceTxHash` field, so §7.1
  layer 3 has something to pass. The widget must write it as soon as the funding transaction is
  broadcast — not after the backend attributes it, which is the very window being guarded.
- The single completion observer of the original spec §6.4 changes shape, because a FAILED order
  now resolves instead of throwing.

## 10. Testing

All tests are `*.unit.spec.ts` with msw, using the existing `setupTestServer()` pattern and the
`fundingOrders.unit.mock.ts` fixtures.

**`convertOrderToRoute.unit.spec.ts`**
- The caller's `FundingOrder` is byte-identical after conversion.
- The produced step carries `fundingOrderId` and `estimate.skipPermit === true`.

**`fundingOrderStep.unit.spec.ts`**
- The predicate narrows, so `step.fundingOrderId` needs no assertion.
- `getFundingOrderUpdatedStep` sets `estimate.skipPermit === true`.

**`fundingExecution.unit.spec.ts`**
- Resolves with a FAILED order for all three order types.
- Resolves with a DONE order.
- Rejects with `LiFiErrorCode.Timeout` when the order stays PENDING.
- `resumeFundingOrder` prefers the live route from `getActiveRoute`.
- `resumeFundingOrder` polls only, and sends nothing, when `sourceTxHash` is supplied.
- `integrator` reaches every order read.

**`WaitForFundingOrderTask.unit.spec.ts`**
- The action carries `substatus: 'WAIT_DESTINATION_TRANSACTION'` before the first poll.
- Re-entry on an action that already holds a stale substatus resets it to the sentinel.
- A DONE order without `result.toTxHash` leaves the source `txHash` and `txLink` in place.
- A timeout returns `{ status: 'PAUSED' }` and leaves `step.execution.status === 'PENDING'`.
- A FAILED order marks the action and execution FAILED and does not throw.

**`waitForFundingOrder.unit.spec.ts`**
- `txHash` is re-sent on every non-terminal poll and dropped once `result.fromTxHash` appears.
- An aborted `signal` rejects and stops polling.
- `integrator` appears on every request.

**`EthereumPrepareTransactionTask.unit.spec.ts`**
- A funding step never calls `stepComparison`.
- A funding step refreshes from the order only when `transactionRequest` is absent.
- The relocated case: a funding step with `typedData` still takes the funding branch.

**`httpError.unit.spec.ts`**
- 422 maps to `LiFiErrorCode.ValidationError`.

**Verification commands**

```
pnpm check:types
pnpm check
pnpm --filter @lifi/sdk test:unit
pnpm --filter @lifi/sdk-provider-ethereum test:unit
```

## 11. Changeset

Amend the existing `.changeset/funding-orders-surface.md`. Both `@lifi/sdk` and
`@lifi/sdk-provider-ethereum` stay **minor**, because the funding surface is unreleased and every
change here lands before the first publish.

The classification sentence needs a rewrite, not a deletion. 401 and 422 both moved off
`InternalError`, so the global change is still worth stating — but both now land on
`LiFiErrorCode.ValidationError`, not `TransactionConflict`:

> HTTP 401 and 422 responses are now classified as `LiFiErrorCode.ValidationError` across all
> endpoints (previously `InternalError`). `createFundingOrder` reports a 422 with a message naming
> `partnerOrderId` reuse.

## 12. Finding-to-section map

| # | Finding | Section |
|---|---|---|
| 1 | A signed permit is discarded, and the transaction reverts | §5.1, §5.2, §8.1 |
| 2 | `resumeFundingOrder` can send the funding transaction twice | §7.1 |
| 3 | The terminal update erases the source transaction hash | §7.3 |
| 4 | The funding predicate sits at one decision point only | Closed — §3.1 |
| 5 | The two prepare slots have diverged | §8.1 |
| 6 | A poll timeout marks the execution FAILED | §6.2 |
| 7 | The funding substatus trips the chain-check guard | §7.2 |
| 8 | 422 maps to a code that already means something else | §8.2 |
| 9 | The polling loop takes no `AbortSignal` | §7.5 |
| 10 | `executeFundingOrder` can resolve with a PENDING order | §6.3 |
| 11 | The source-transaction report is a single swallowed attempt | §7.4 |
| 12 | Keyless lookups cannot be polled | §7.5 |
| 13 | `convertOrderToRoute` mutates its input | §5.1 |
| 14 | The FAILED contract is asymmetric by branch | §6.1, §6.4 |
| 15 | `isFundingOrderStep` does not narrow, and a type is duplicated | §5.4 |
