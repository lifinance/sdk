# Funding Orders Post-Review Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 14 open findings from the code review of the funding orders surface on branch `feat/funding-orders-integration`, so a funding order cannot revert after the user signs, cannot send twice, and exposes one completion contract.

**Architecture:** All behaviour changes stay in `@lifi/sdk`, except one restructure of `EthereumPrepareTransactionTask` that moves the funding branch out of `getUpdatedStep`. The funding permit gate reuses the existing `estimate.skipPermit` switch instead of adding a funding predicate to the Ethereum provider. The funding wait slot writes the `WAIT_DESTINATION_TRANSACTION` sentinel so provider guards treat a funding step exactly like a normal bridge.

**Tech Stack:** TypeScript (strict, `isolatedDeclarations: true`), pnpm monorepo, vitest + msw (`*.unit.spec.ts`), Biome, Changesets.

**Spec:** `docs/funding-orders/specs/2026-08-12-funding-orders-review-fixes-design.md`. Read §4 (decisions) and §12 (finding-to-section map) before starting. The original design is `docs/funding-orders/specs/2026-08-11-funding-orders-sdk-widget-integration-design.md`; the predecessor plan is `docs/funding-orders/plans/2026-08-11-funding-orders-sdk.md`.

## Global Constraints

- `isolatedDeclarations: true` — every exported function needs an explicit return type annotation.
- No default exports in library code.
- Test files are named `*.unit.spec.ts`; shared fixtures `*.unit.mock.ts`; msw handlers live in `packages/sdk/src/actions/actions.unit.handlers.ts` (`setupTestServer()` pattern).
- Run tests with `pnpm --filter @lifi/sdk test:unit` and `pnpm --filter @lifi/sdk-provider-ethereum test:unit`. Type-check with `pnpm check:types`. Lint with `pnpm check` (Biome).
- The husky pre-commit hook runs `pnpm check && pnpm check:types && pnpm check:circular-deps && pnpm knip:check`. Every commit must pass all four. `check:circular-deps` is madge — do not introduce an import from `core/tasks/**` to `core/fundingExecution.js`, not even a type import.
- Commits follow the repo's scoped conventional style (`fix(funding): …`, `refactor(funding): …`, `test(funding): …`).
- Do **not** add a new changeset. Task 8 amends the existing `.changeset/funding-orders-surface.md`.
- Do **not** touch `packages/*/src/version.ts`. Those 6 files are modified in the working tree for unrelated reasons. Never use `git commit -a`; always stage explicit paths.
- The open-string funding `substatus` must never be written to `ExecutionAction.substatus`. It reaches callers through `onOrderUpdate` only. No `as any` casts remain when this plan is done.

## File Structure

**`packages/sdk/src/types/funding.ts`** (modify) — owns every funding option type. `FundingExecutionOptions` moves here from `core/fundingExecution.ts` so `core/tasks/` can import it without a madge cycle.

**`packages/sdk/src/utils/fundingOrderStep.ts`** (modify) — the funding step predicate and the committed-quote refresh. Gains type narrowing and the `skipPermit` marker.

**`packages/sdk/src/utils/convertOrderToRoute.ts`** (modify) — the order-to-route adapter. Gains a clone so it stops mutating the caller's order.

**`packages/sdk/src/utils/sleep.ts`** (modify) — gains an optional `AbortSignal`. Six existing callers must keep working, so the parameter is additive.

**`packages/sdk/src/actions/waitForFundingOrder.ts`** (modify) — the poll loop. Gains `txHash` re-reporting, `integrator` scoping, and abort support.

**`packages/sdk/src/core/tasks/WaitForFundingOrderTask.ts`** (modify) — the wait slot. Gains the sentinel substatus, a guarded terminal update, and non-throwing FAILED / PAUSED-on-timeout behaviour.

**`packages/sdk/src/core/fundingExecution.ts`** (modify) — the two entry points. Gains the terminal-order capture and the three-layer resume.

**`packages/sdk/src/errors/httpError.ts`** (modify) — the global status map. The 422 entry narrows back to `ValidationError`.

**`packages/sdk/src/actions/createFundingOrder.ts`** (modify) — gains the funding-specific 422 message.

**`packages/sdk-provider-ethereum/src/core/tasks/EthereumPrepareTransactionTask.ts`** (modify) — gains the explicit funding branch that mirrors the core task.

**`packages/sdk-provider-ethereum/src/core/tasks/helpers/getUpdatedStep.ts`** (modify) — loses its funding branch, so it can no longer drop `signedTypedData`.

---

### Task 1: Narrow the funding step predicate

**Findings:** 15.

**Files:**
- Modify: `packages/sdk/src/utils/fundingOrderStep.ts:11-14`
- Modify: `packages/sdk/src/core/tasks/WaitForFundingOrderTask.ts:23-28`
- Test: `packages/sdk/src/utils/fundingOrderStep.unit.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `isFundingOrderStep(step: LiFiStep | LiFiStepExtended): step is LiFiStepExtended & { fundingOrderId: string }`. Tasks 2, 3 and 5 rely on the narrowing.

- [ ] **Step 1: Write the failing test**

Append to `packages/sdk/src/utils/fundingOrderStep.unit.spec.ts`, inside the existing `describe('isFundingOrderStep', ...)` block:

```ts
  it('narrows fundingOrderId to string for the compiler', () => {
    const candidate = {
      id: 'step-1',
      fundingOrderId: 'order-1',
    } as LiFiStepExtended
    if (!isFundingOrderStep(candidate)) {
      throw new Error('expected a funding order step')
    }
    // No non-null assertion below. This line fails to compile if the
    // predicate returns plain boolean instead of narrowing.
    const orderId: string = candidate.fundingOrderId
    expect(orderId).toBe('order-1')
  })
```

- [ ] **Step 2: Run the type check to verify it fails**

Run: `pnpm --filter @lifi/sdk check:types`
Expected: FAIL with `Type 'string | undefined' is not assignable to type 'string'` in `fundingOrderStep.unit.spec.ts`.

- [ ] **Step 3: Narrow the predicate**

In `packages/sdk/src/utils/fundingOrderStep.ts`, replace the `isFundingOrderStep` declaration:

```ts
export function isFundingOrderStep(
  step: LiFiStep | LiFiStepExtended
): step is LiFiStepExtended & { fundingOrderId: string } {
  const id = (step as LiFiStepExtended).fundingOrderId
  return typeof id === 'string' && id.length > 0
}
```

- [ ] **Step 4: Remove the non-null assertion at the use site**

In `packages/sdk/src/core/tasks/WaitForFundingOrderTask.ts`, add the import:

```ts
import { ValidationError } from '../../errors/errors.js'
import { isFundingOrderStep } from '../../utils/fundingOrderStep.js'
```

Then replace the `const orderId = step.fundingOrderId!` line with a real guard:

```ts
    const { client, step, statusManager, isBridgeExecution, toChain } = context
    if (!isFundingOrderStep(step)) {
      throw new ValidationError(
        'WaitForFundingOrderTask requires a step with fundingOrderId.'
      )
    }
    const orderId = step.fundingOrderId
```

- [ ] **Step 5: Add the guard test**

Append to `packages/sdk/src/core/tasks/WaitForFundingOrderTask.unit.spec.ts`, inside `describe('WaitForFundingOrderTask', ...)`:

```ts
  it('throws a ValidationError for a step without fundingOrderId', async () => {
    const step = { id: 'step-1', action: {} } as unknown as LiFiStepExtended
    await expect(
      new WaitForFundingOrderTask('RECEIVING_CHAIN').run(buildContext(step))
    ).rejects.toMatchObject({ code: LiFiErrorCode.ValidationError })
    expect(vi.mocked(waitForFundingOrder)).not.toHaveBeenCalled()
  })
```

- [ ] **Step 6: Run the tests and the type check**

Run: `pnpm --filter @lifi/sdk check:types && pnpm --filter @lifi/sdk test:unit`
Expected: PASS. The type check is clean and the whole `@lifi/sdk` suite is green.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/utils/fundingOrderStep.ts \
        packages/sdk/src/utils/fundingOrderStep.unit.spec.ts \
        packages/sdk/src/core/tasks/WaitForFundingOrderTask.ts \
        packages/sdk/src/core/tasks/WaitForFundingOrderTask.unit.spec.ts
git commit -m "fix(funding): narrow isFundingOrderStep to a type predicate"
```

---

### Task 2: Stop mutating the order, and gate the permit path

**Findings:** 1 (the gate), 13.

A funding order can never use permit: its `transactionRequest` is committed at order creation and targets `estimate.approvalAddress`. `estimate.skipPermit` is the switch that already means this. `isPermit2Supported` reads it, and `EthereumCheckAllowanceTask`, `EthereumSetAllowanceTask`, `EthereumResetAllowanceTask` and `EthereumStandardSignAndExecuteTask` all consult that helper. `EthereumNativePermitTask` reads it directly. So setting it here closes the whole permit2 path with no Ethereum provider change.

`convertQuoteToRoute` builds `steps: [quote]` with no clone, so `route.steps[0] === order.quote`. The clone is therefore required, not cosmetic — without it this task writes `skipPermit` into the caller's `FundingOrder`.

**Files:**
- Modify: `packages/sdk/src/utils/convertOrderToRoute.ts:28-32`
- Modify: `packages/sdk/src/utils/fundingOrderStep.ts:38-44`
- Test: `packages/sdk/src/utils/convertOrderToRoute.unit.spec.ts`
- Test: `packages/sdk/src/utils/fundingOrderStep.unit.spec.ts`

**Interfaces:**
- Consumes: `isFundingOrderStep` narrowing from Task 1.
- Produces: every funding step carries `estimate.skipPermit === true`. Task 3 relies on `getFundingOrderUpdatedStep` returning it.

- [ ] **Step 1: Write the failing tests**

Append to `packages/sdk/src/utils/convertOrderToRoute.unit.spec.ts`, inside `describe('convertOrderToRoute', ...)`:

```ts
  it('sets skipPermit on the produced step', () => {
    const order = buildFundingOrder({ quote: buildQuote() })
    const route = convertOrderToRoute(order)
    expect(route.steps[0].estimate.skipPermit).toBe(true)
  })

  it('leaves the caller order untouched', () => {
    const order = buildFundingOrder({ quote: buildQuote() })
    const before = structuredClone(order)
    convertOrderToRoute(order)
    expect(order).toEqual(before)
  })
```

Append to `packages/sdk/src/utils/fundingOrderStep.unit.spec.ts`, inside `describe('getFundingOrderUpdatedStep', ...)`:

```ts
  it('sets skipPermit without mutating the fetched order estimate', async () => {
    const quote = {
      id: 'server-quote-id',
      estimate: { approvalAddress: '0xApproval', toAmount: '990000' },
      transactionRequest: { to: '0xTo', data: '0xdata' },
    }
    const order = buildFundingOrder({ quote: quote as any })
    vi.mocked(getFundingOrder).mockResolvedValue(order)
    const updated = await getFundingOrderUpdatedStep({} as any, step)
    expect(updated.estimate.skipPermit).toBe(true)
    expect(updated.estimate.approvalAddress).toBe('0xApproval')
    expect(order.quote!.estimate).not.toBe(updated.estimate)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @lifi/sdk test:unit -- convertOrderToRoute fundingOrderStep`
Expected: FAIL — `expected undefined to be true` for both `skipPermit` assertions, and the caller-order assertion fails because `fundingOrderId` was written onto `order.quote`.

- [ ] **Step 3: Clone in the converter**

Replace the body of `convertOrderToRoute` after the two guards in `packages/sdk/src/utils/convertOrderToRoute.ts`:

```ts
  // Clone before marking: convertQuoteToRoute puts the quote into steps[0] by
  // reference, so writing the markers would pollute the caller's order.
  const route = convertQuoteToRoute(structuredClone(order.quote))
  route.id = order.orderId
  const step = route.steps[0] as LiFiStepExtended
  step.fundingOrderId = order.orderId
  // A funding order can never use permit: transactionRequest is committed at
  // order creation and targets estimate.approvalAddress.
  step.estimate.skipPermit = true
  return route
```

- [ ] **Step 4: Set the marker on the refresh path**

Replace the return statement of `getFundingOrderUpdatedStep` in `packages/sdk/src/utils/fundingOrderStep.ts`:

```ts
  return {
    ...order.quote,
    // Copy the estimate so the marker cannot leak into the fetched order.
    estimate: { ...order.quote.estimate, skipPermit: true },
    id: step.id,
    fundingOrderId: step.fundingOrderId,
    execution: step.execution,
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @lifi/sdk test:unit -- convertOrderToRoute fundingOrderStep`
Expected: PASS.

- [ ] **Step 6: Run the full suite and the type check**

Run: `pnpm --filter @lifi/sdk check:types && pnpm --filter @lifi/sdk test:unit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/utils/convertOrderToRoute.ts \
        packages/sdk/src/utils/convertOrderToRoute.unit.spec.ts \
        packages/sdk/src/utils/fundingOrderStep.ts \
        packages/sdk/src/utils/fundingOrderStep.unit.spec.ts
git commit -m "fix(funding): clone the committed quote and skip the permit path"
```

---

### Task 3: Converge the two prepare slots

**Findings:** 1 (the root cause), 5.

`getUpdatedStep`'s funding branch ignores its `signedTypedData` argument. Combined with a native permit that the user already signed, that produced the revert of finding 1. Task 2 stops the permit from being signed; this task removes the branch that could drop the signature at all.

`EthereumPrepareTransactionTask` also calls `getUpdatedStep` unconditionally and always calls `stepComparison`. The core `PrepareTransactionTask` guards both on `!step.transactionRequest`. After this task the two slots have the same shape.

**Files:**
- Modify: `packages/sdk-provider-ethereum/src/core/tasks/EthereumPrepareTransactionTask.ts:40-60`
- Modify: `packages/sdk-provider-ethereum/src/core/tasks/helpers/getUpdatedStep.ts:21-36`
- Delete: `packages/sdk-provider-ethereum/src/core/tasks/helpers/getUpdatedStep.unit.spec.ts`
- Create: `packages/sdk-provider-ethereum/src/core/tasks/EthereumPrepareTransactionTask.unit.spec.ts`

**Interfaces:**
- Consumes: `isFundingOrderStep` (Task 1) and `getFundingOrderUpdatedStep` (Task 2), both from `@lifi/sdk`.
- Produces: `getUpdatedStep(client, step, executionOptions?, signedTypedData?)` keeps its signature but is never called for a funding step.

- [ ] **Step 1: Write the failing test**

Create `packages/sdk-provider-ethereum/src/core/tasks/EthereumPrepareTransactionTask.unit.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@lifi/sdk', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getFundingOrderUpdatedStep: vi.fn(),
  stepComparison: vi.fn(),
}))
vi.mock('./helpers/getUpdatedStep.js', () => ({
  getUpdatedStep: vi.fn(),
}))
vi.mock('../../actions/getMaxPriorityFeePerGas.js', () => ({
  getMaxPriorityFeePerGas: vi.fn(),
}))
// run() ends with getEthereumExecutionStrategy(context, true) at line 121,
// which reaches isBatchingSupported(client, { chainId: fromChain.id }). Mock it
// so these tests exercise the prepare branch, not the strategy recomputation.
vi.mock('./helpers/getEthereumExecutionStrategy.js', () => ({
  getEthereumExecutionStrategy: vi.fn(async () => 'standard'),
}))

import {
  getFundingOrderUpdatedStep,
  type LiFiStepExtended,
  stepComparison,
} from '@lifi/sdk'
import { EthereumPrepareTransactionTask } from './EthereumPrepareTransactionTask.js'
import { getUpdatedStep } from './helpers/getUpdatedStep.js'

const buildFundingStep = (
  overrides?: Partial<LiFiStepExtended>
): LiFiStepExtended =>
  ({
    id: 'step-1',
    fundingOrderId: 'order-1',
    action: { fromChainId: 1, toChainId: 137 },
    estimate: { approvalAddress: '0xApproval', skipPermit: true },
    transactionRequest: { to: '0xTo', data: '0xdata' },
    includedSteps: [],
    ...overrides,
  }) as unknown as LiFiStepExtended

const buildContext = (step: LiFiStepExtended) =>
  ({
    client: {} as any,
    step,
    executionOptions: undefined,
    statusManager: {
      findAction: vi.fn(() => ({ type: 'SWAP' })),
      updateAction: vi.fn(),
    } as any,
    allowUserInteraction: false,
    checkClient: vi.fn(),
    isBridgeExecution: false,
    signedTypedData: undefined,
    // account.type must not be 'local', or run() calls checkClient and
    // getMaxPriorityFeePerGas instead of reading the committed request.
    ethereumClient: { account: { type: 'json-rpc' } },
    fromChain: { id: 1, permit2Proxy: '0xProxy' },
  }) as any

beforeEach(() => {
  vi.clearAllMocks()
})

describe('EthereumPrepareTransactionTask — funding branch', () => {
  it('never compares rates for a funding step', async () => {
    const step = buildFundingStep()
    await new EthereumPrepareTransactionTask().run(buildContext(step))
    expect(vi.mocked(stepComparison)).not.toHaveBeenCalled()
    expect(vi.mocked(getUpdatedStep)).not.toHaveBeenCalled()
  })

  it('does not refetch the order when the transactionRequest is present', async () => {
    const step = buildFundingStep()
    await new EthereumPrepareTransactionTask().run(buildContext(step))
    expect(vi.mocked(getFundingOrderUpdatedStep)).not.toHaveBeenCalled()
  })

  it('restores the committed quote when the transactionRequest is missing', async () => {
    const step = buildFundingStep({ transactionRequest: undefined })
    vi.mocked(getFundingOrderUpdatedStep).mockResolvedValue(
      buildFundingStep({ transactionRequest: { to: '0xTo', data: '0xfresh' } })
    )
    await new EthereumPrepareTransactionTask().run(buildContext(step))
    expect(vi.mocked(getFundingOrderUpdatedStep)).toHaveBeenCalledTimes(1)
    expect(step.transactionRequest?.data).toBe('0xfresh')
    expect(vi.mocked(stepComparison)).not.toHaveBeenCalled()
  })

  it('takes the funding branch even when the step carries typedData', async () => {
    // Relocated from getUpdatedStep.unit.spec.ts. The backend rejects gasless
    // for funding orders, so this is defensive - funding must still win.
    const step = buildFundingStep({
      transactionRequest: undefined,
      typedData: [
        { primaryType: 'PermitWitnessTransferFrom', message: {} },
      ] as any,
    })
    vi.mocked(getFundingOrderUpdatedStep).mockResolvedValue(
      buildFundingStep({ transactionRequest: { to: '0xTo', data: '0xfresh' } })
    )
    await new EthereumPrepareTransactionTask().run(buildContext(step))
    expect(vi.mocked(getFundingOrderUpdatedStep)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(getUpdatedStep)).not.toHaveBeenCalled()
  })
})

describe('EthereumPrepareTransactionTask — standard branch', () => {
  it('still refreshes and compares a non-funding step', async () => {
    const step = buildFundingStep({ fundingOrderId: undefined })
    vi.mocked(getUpdatedStep).mockResolvedValue(step)
    vi.mocked(stepComparison).mockResolvedValue(step)
    await new EthereumPrepareTransactionTask().run(buildContext(step))
    expect(vi.mocked(getUpdatedStep)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(stepComparison)).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lifi/sdk-provider-ethereum test:unit -- EthereumPrepareTransactionTask`
Expected: FAIL — `stepComparison` and `getUpdatedStep` are called for the funding step, because the task has no funding branch yet.

- [ ] **Step 3: Add the funding branch to the Ethereum prepare task**

In `packages/sdk-provider-ethereum/src/core/tasks/EthereumPrepareTransactionTask.ts`, add to the `@lifi/sdk` import list:

```ts
  getFundingOrderUpdatedStep,
  isFundingOrderStep,
```

Then replace the block that begins with the `// Try to prepare a new transaction request` comment and ends with the `Object.assign(step, { ...comparedStep, ... })` call:

```ts
    if (isFundingOrderStep(step)) {
      // Funding orders have no re-quote endpoint - the order holds the
      // committed quote, so restore it only when the request is missing and
      // never run the rate-change comparison.
      if (!step.transactionRequest) {
        const updatedStep = await getFundingOrderUpdatedStep(client, step)
        Object.assign(step, updatedStep, { execution: step.execution })
      }
    } else {
      // Try to prepare a new transaction request and update the step with typed data
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

- [ ] **Step 4: Remove the funding branch from `getUpdatedStep`**

In `packages/sdk-provider-ethereum/src/core/tasks/helpers/getUpdatedStep.ts`, delete these three lines from the top of the function body:

```ts
  if (isFundingOrderStep(step)) {
    return getFundingOrderUpdatedStep(client, step)
  }
```

Then delete `getFundingOrderUpdatedStep` and `isFundingOrderStep` from the `@lifi/sdk` import list at the top of the file. Leave every other branch untouched.

- [ ] **Step 5: Delete the obsolete spec**

The whole file only tested the branch that Step 4 removed. Its one valuable case moved to Step 1.

```bash
git rm packages/sdk-provider-ethereum/src/core/tasks/helpers/getUpdatedStep.unit.spec.ts
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @lifi/sdk-provider-ethereum check:types && pnpm --filter @lifi/sdk-provider-ethereum test:unit`
Expected: PASS. No unused-import errors in `getUpdatedStep.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk-provider-ethereum/src/core/tasks/EthereumPrepareTransactionTask.ts \
        packages/sdk-provider-ethereum/src/core/tasks/EthereumPrepareTransactionTask.unit.spec.ts \
        packages/sdk-provider-ethereum/src/core/tasks/helpers/getUpdatedStep.ts \
        packages/sdk-provider-ethereum/src/core/tasks/helpers/getUpdatedStep.unit.spec.ts
git commit -m "refactor(funding): move the ethereum funding branch into the prepare task"
```

---

### Task 4: Abort, scope, and re-report in the poll loop

**Findings:** 9, 11 (the loop half), 12.

Three gaps close together, because all three are parameters the loop never had. `getFundingOrder` already accepts `RequestOptions`, so the signal threads straight through. `sleep` has six other callers, so its new parameter must be additive.

**Files:**
- Modify: `packages/sdk/src/utils/sleep.ts`
- Modify: `packages/sdk/src/types/funding.ts:90-98`
- Modify: `packages/sdk/src/actions/waitForFundingOrder.ts:33-73`
- Test: `packages/sdk/src/actions/waitForFundingOrder.unit.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `sleep(ms: number, signal?: AbortSignal): Promise<null>`
  - `WaitForFundingOrderOptions` gains `txHash?: string`, `integrator?: string`, `signal?: AbortSignal`. Task 5 passes all three.

- [ ] **Step 1: Write the failing tests**

Append to `packages/sdk/src/actions/waitForFundingOrder.unit.spec.ts`, inside `describe('waitForFundingOrder', ...)`:

```ts
  it('re-reports txHash on every poll until the order acknowledges it', async () => {
    const seen: (string | null)[] = []
    let calls = 0
    server.use(
      http.get(
        `${client.config.apiUrl}/funding/orders/:orderId`,
        async ({ request: req }) => {
          calls++
          seen.push(new URL(req.url).searchParams.get('txHash'))
          if (calls < 3) {
            return HttpResponse.json(buildFundingOrder())
          }
          if (calls === 3) {
            return HttpResponse.json(
              buildFundingOrder({ result: { fromTxHash: '0xsource' } })
            )
          }
          return HttpResponse.json(buildFundingOrder({ status: 'DONE' }))
        }
      )
    )
    const order = await waitForFundingOrder(client, 'order-1', {
      pollingInterval: 10,
      txHash: '0xsource',
    })
    expect(order.status).toBe('DONE')
    expect(seen.slice(0, 3)).toEqual(['0xsource', '0xsource', '0xsource'])
    expect(seen[3]).toBeNull()
  })

  it('forwards integrator on every poll', async () => {
    const seen: (string | null)[] = []
    let calls = 0
    server.use(
      http.get(
        `${client.config.apiUrl}/funding/orders/:orderId`,
        async ({ request: req }) => {
          calls++
          seen.push(new URL(req.url).searchParams.get('integrator'))
          return HttpResponse.json(
            buildFundingOrder(calls < 2 ? {} : { status: 'DONE' })
          )
        }
      )
    )
    await waitForFundingOrder(client, 'order-1', {
      pollingInterval: 10,
      integrator: 'jumper',
    })
    expect(seen).toEqual(['jumper', 'jumper'])
  })

  it('rejects and stops polling when the signal aborts', async () => {
    let calls = 0
    server.use(
      http.get(`${client.config.apiUrl}/funding/orders/:orderId`, async () => {
        calls++
        return HttpResponse.json(buildFundingOrder())
      })
    )
    const controller = new AbortController()
    const pending = waitForFundingOrder(client, 'order-1', {
      pollingInterval: 10_000,
      signal: controller.signal,
    })
    // Let the first poll land, then abort during the sleep.
    await vi.waitFor(() => expect(calls).toBe(1))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toBe(1)
  })

  it('rejects before the first request when the signal is already aborted', async () => {
    const before = mockedFetch.mock.calls.length
    await expect(
      waitForFundingOrder(client, 'order-1', {
        pollingInterval: 10,
        signal: AbortSignal.abort(),
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockedFetch.mock.calls.length).toBe(before)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @lifi/sdk test:unit -- waitForFundingOrder`
Expected: FAIL — the type check rejects `txHash`, `integrator` and `signal` as unknown properties on `WaitForFundingOrderOptions`.

- [ ] **Step 3: Add the option fields**

In `packages/sdk/src/types/funding.ts`, replace the `WaitForFundingOrderOptions` interface:

```ts
export interface WaitForFundingOrderOptions {
  /** Milliseconds between polls. Keep >= 10_000: each non-terminal read triggers a backend refresh. */
  pollingInterval?: number
  /** Milliseconds until the wait rejects with LiFiErrorCode.Timeout. The order stays PENDING. */
  timeout?: number
  /** Fires on every status/substatus transition, including the terminal one. */
  onUpdate?: (order: FundingOrder) => void
  /**
   * Source transaction to report. Re-sent on every non-terminal poll until the
   * order reports result.fromTxHash, so one failed report cannot strand the order.
   */
  txHash?: string
  /** Scopes every poll. Required for keyless partnerOrderId lookups. */
  integrator?: string
  /** Cancels the wait between polls and aborts the in-flight request. */
  signal?: AbortSignal
}
```

- [ ] **Step 4: Make `sleep` abortable**

Replace the whole of `packages/sdk/src/utils/sleep.ts`. The signal parameter is optional, so the six existing callers keep working unchanged:

```ts
export function sleep(ms: number, signal?: AbortSignal): Promise<null> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason)
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal!.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve(null)
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
```

- [ ] **Step 5: Thread all three through the loop**

In `packages/sdk/src/actions/waitForFundingOrder.ts`, replace everything from `const pollingInterval = ...` to the end of the function:

```ts
  const pollingInterval = options?.pollingInterval ?? 10_000
  const timeout = options?.timeout ?? 1_200_000
  const signal = options?.signal
  const deadline = Date.now() + timeout
  let previous: FundingOrder | undefined
  // The backend can also attribute the transfer through its own indexers, so
  // stop re-reporting as soon as the order acknowledges the source hash.
  let sourceAcknowledged = false
  while (true) {
    if (signal?.aborted) {
      throw signal.reason
    }
    const order = await getFundingOrder(
      client,
      orderId,
      {
        ...(!sourceAcknowledged && options?.txHash
          ? { txHash: options.txHash }
          : {}),
        ...(options?.integrator ? { integrator: options.integrator } : {}),
      },
      { signal }
    ).catch((error: unknown) => {
      const cause = (error as SDKError).cause
      if (
        cause instanceof HTTPError &&
        (cause.status === 400 ||
          cause.status === 401 ||
          cause.status === 404 ||
          cause.status === 422)
      ) {
        throw error
      }
      if (signal?.aborted) {
        throw error
      }
      return undefined
    })
    if (order) {
      if (order.result?.fromTxHash) {
        sourceAcknowledged = true
      }
      const transitioned =
        previous?.status !== order.status ||
        previous?.substatus !== order.substatus
      if (transitioned) {
        options?.onUpdate?.(order)
      }
      previous = order
      if (order.status === 'DONE' || order.status === 'FAILED') {
        return order
      }
    }
    if (Date.now() >= deadline) {
      throw new SDKError(
        new TransactionError(
          LiFiErrorCode.Timeout,
          `Funding order ${orderId} did not reach a terminal state within ${timeout}ms.`
        )
      )
    }
    await sleep(pollingInterval, signal)
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @lifi/sdk check:types && pnpm --filter @lifi/sdk test:unit -- waitForFundingOrder`
Expected: PASS, including the four pre-existing cases in that file.

- [ ] **Step 7: Run the full suite**

Run: `pnpm --filter @lifi/sdk test:unit`
Expected: PASS. `checkBalance`, `waitForResult`, `request` and `withTimeout` all still use the one-argument `sleep`.

- [ ] **Step 8: Commit**

```bash
git add packages/sdk/src/utils/sleep.ts \
        packages/sdk/src/types/funding.ts \
        packages/sdk/src/actions/waitForFundingOrder.ts \
        packages/sdk/src/actions/waitForFundingOrder.unit.spec.ts
git commit -m "fix(funding): support abort, integrator scoping, and txHash re-reporting while polling"
```

---

### Task 5: Rework the funding wait slot

**Findings:** 3, 6, 7, 11 (the wiring half), 14 (the no-throw half).

Four behaviour changes land together, because all four are in one `run` method and each one alone would leave the slot inconsistent:

1. The sentinel substatus, so `EthereumWaitForTransactionStatusTask`'s chain check treats a funding step like a normal bridge. That guard runs at lines 19-27, **before** it delegates at line 29, and an action with `substatus: undefined` also fails its `!== 'WAIT_DESTINATION_TRANSACTION'` test — so the guard trips on re-entry today whether or not a funding substatus is written.
2. The guarded terminal update. `statusManager.ts:207` ends in `Object.assign(currentAction, rest)`, and `Object.assign` copies an explicit `undefined`.
3. `txHash` forwarded into the wait instead of reported once.
4. FAILED marks without throwing; a timeout returns `PAUSED`.

`initializeAction` cannot carry the sentinel. Its `ActionProps` type at `statusManager.ts:12-17` is `{ step, type, chainId, status }` only. The sentinel therefore needs a separate `updateAction` call. Do not extend `ActionProps`: `initializeAction` reuses an existing action by calling `updateAction(step, type, status, { error: undefined })`, which leaves an earlier substatus in place, so the explicit call is what makes the sentinel correct on both first entry and re-entry.

**Files:**
- Modify: `packages/sdk/src/types/funding.ts` (add `FundingExecutionOptions`)
- Modify: `packages/sdk/src/core/fundingExecution.ts:10-17` (re-export it)
- Modify: `packages/sdk/src/core/tasks/WaitForFundingOrderTask.ts` (rewrite `run`)
- Test: `packages/sdk/src/core/tasks/WaitForFundingOrderTask.unit.spec.ts`

**Interfaces:**
- Consumes: `isFundingOrderStep` narrowing (Task 1); `txHash`, `integrator`, `signal` on `WaitForFundingOrderOptions` (Task 4).
- Produces:
  - `FundingExecutionOptions` lives in `types/funding.ts` and is re-exported from `core/fundingExecution.ts`, so `index.ts` needs no change. Task 6 extends it.
  - The wait task returns `{ status: 'COMPLETED' }` for DONE **and** FAILED, and `{ status: 'PAUSED' }` on timeout. Task 6 depends on both.

- [ ] **Step 1: Move `FundingExecutionOptions` into the types module**

`core/tasks/WaitForFundingOrderTask.ts` must not import from `core/fundingExecution.js` — madge runs on every commit via `check:circular-deps`, and a type import still shows up in its graph.

Append to `packages/sdk/src/types/funding.ts`:

```ts
export interface FundingExecutionOptions extends ExecutionOptions {
  /** Fires on every order status/substatus transition for every order type. */
  onOrderUpdate?: (order: FundingOrder) => void
  /** Poll interval for the order endpoint. Default 10_000. */
  pollingInterval?: number
  /** Timeout for reaching a terminal order state. Default 1_200_000 (20 min). */
  timeout?: number
  /** Scopes every order read. Required for keyless partnerOrderId lookups. */
  integrator?: string
  /** Cancels the wait between polls and aborts the in-flight request. */
  signal?: AbortSignal
}
```

Add the import it needs at the top of the same file:

```ts
import type { ExecutionOptions } from './core.js'
```

In `packages/sdk/src/core/fundingExecution.ts`, delete the local `FundingExecutionOptions` interface and replace it with an import plus a re-export, so the root `index.ts` export list stays valid:

```ts
import type {
  FundingExecutionOptions,
  FundingOrder,
} from '../types/funding.js'

export type { FundingExecutionOptions } from '../types/funding.js'
```

- [ ] **Step 2: Verify the move alone is green**

Run: `pnpm --filter @lifi/sdk check:types && pnpm --filter @lifi/sdk check:circular-deps && pnpm --filter @lifi/sdk test:unit`
Expected: PASS with no behaviour change. Do not commit yet.

- [ ] **Step 3: Rewrite the wait task spec**

Four existing cases assert behaviour this task deliberately changes. Replace the whole of `packages/sdk/src/core/tasks/WaitForFundingOrderTask.unit.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../actions/waitForFundingOrder.js', () => ({
  waitForFundingOrder: vi.fn(),
}))

import { buildFundingOrder } from '../../actions/fundingOrders.unit.mock.js'
import { waitForFundingOrder } from '../../actions/waitForFundingOrder.js'
import { LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError } from '../../errors/errors.js'
import { SDKError } from '../../errors/SDKError.js'
import type { LiFiStepExtended } from '../../types/core.js'
import type { StepExecutorContext } from '../../types/execution.js'
import { WaitForFundingOrderTask } from './WaitForFundingOrderTask.js'
import { WaitForTransactionStatusTask } from './WaitForTransactionStatusTask.js'

const buildStep = (): LiFiStepExtended =>
  ({
    id: 'step-1',
    fundingOrderId: 'order-1',
    action: { fromChainId: 1, toChainId: 137 },
    execution: { status: 'PENDING', actions: [] },
  }) as unknown as LiFiStepExtended

const buildContext = (
  step: LiFiStepExtended,
  sourceAction: Record<string, unknown> = {
    type: 'SWAP',
    txHash: '0xsource',
  }
): StepExecutorContext =>
  ({
    client: {} as any,
    step,
    statusManager: {
      findAction: vi.fn(() => sourceAction),
      initializeAction: vi.fn(() => ({ type: 'RECEIVING_CHAIN' })),
      updateAction: vi.fn(),
      updateExecution: vi.fn(),
    } as any,
    isBridgeExecution: false,
    toChain: { id: 137, metamask: { blockExplorerUrls: ['https://x/'] } },
  }) as unknown as StepExecutorContext

beforeEach(() => {
  vi.clearAllMocks()
})

describe('WaitForFundingOrderTask', () => {
  it('writes the sentinel substatus before the first poll', async () => {
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    const step = buildStep()
    const context = buildContext(step)

    await new WaitForFundingOrderTask('RECEIVING_CHAIN').run(context)

    expect(context.statusManager.updateAction).toHaveBeenNthCalledWith(
      1,
      step,
      'RECEIVING_CHAIN',
      'PENDING',
      { substatus: 'WAIT_DESTINATION_TRANSACTION' }
    )
  })

  it('resets a stale substatus to the sentinel on re-entry', async () => {
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    const step = buildStep()
    const context = buildContext(step)
    vi.mocked(context.statusManager.initializeAction).mockReturnValue({
      type: 'RECEIVING_CHAIN',
      substatus: 'INTENT_AWAITING_FUNDS',
    } as any)

    await new WaitForFundingOrderTask('RECEIVING_CHAIN').run(context)

    expect(context.statusManager.updateAction).toHaveBeenNthCalledWith(
      1,
      step,
      'RECEIVING_CHAIN',
      'PENDING',
      { substatus: 'WAIT_DESTINATION_TRANSACTION' }
    )
  })

  it('forwards the source txHash, integrator and signal into the wait', async () => {
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    const signal = new AbortController().signal
    const context = buildContext(buildStep())
    context.executionOptions = {
      integrator: 'jumper',
      signal,
      pollingInterval: 3_000,
      timeout: 60_000,
    } as any

    await new WaitForFundingOrderTask('RECEIVING_CHAIN').run(context)

    expect(vi.mocked(waitForFundingOrder)).toHaveBeenCalledWith(
      context.client,
      'order-1',
      expect.objectContaining({
        txHash: '0xsource',
        integrator: 'jumper',
        signal,
        pollingInterval: 10_000,
        timeout: 60_000,
      })
    )
  })

  it('never writes the open-string funding substatus to the action', async () => {
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE', substatus: 'COMPLETED' })
    )
    const step = buildStep()
    const context = buildContext(step)
    const onOrderUpdate = vi.fn()
    context.executionOptions = { onOrderUpdate } as any

    await new WaitForFundingOrderTask('RECEIVING_CHAIN').run(context)

    const onUpdate = vi.mocked(waitForFundingOrder).mock.calls[0][2]!.onUpdate!
    vi.mocked(context.statusManager.updateAction).mockClear()

    const pending = buildFundingOrder({
      status: 'PENDING',
      substatus: 'INTENT_AWAITING_FUNDS',
    })
    onUpdate(pending)

    expect(onOrderUpdate).toHaveBeenCalledWith(pending)
    expect(context.statusManager.updateAction).not.toHaveBeenCalled()
  })

  it('keeps the source txHash when a DONE order carries no toTxHash', async () => {
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({
        status: 'DONE',
        result: { fromTxHash: '0xsource', toAmount: '990000' },
      })
    )
    const step = buildStep()
    const context = buildContext(step)

    await new WaitForFundingOrderTask('SWAP').run(context)

    const terminal = vi
      .mocked(context.statusManager.updateAction)
      .mock.calls.find((call) => call[2] === 'DONE')!
    expect(terminal[3]).toEqual({ chainId: 137 })
    expect(terminal[3]).not.toHaveProperty('txHash')
    expect(terminal[3]).not.toHaveProperty('txLink')
  })

  it('writes txHash and txLink when a DONE order carries toTxHash', async () => {
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({
        status: 'DONE',
        result: { toTxHash: '0xdest', toAmount: '990000' },
      })
    )
    const step = buildStep()
    const context = buildContext(step)

    const result = await new WaitForFundingOrderTask('RECEIVING_CHAIN').run(
      context
    )

    expect(result.status).toBe('COMPLETED')
    expect(context.statusManager.updateAction).toHaveBeenCalledWith(
      step,
      'RECEIVING_CHAIN',
      'DONE',
      { chainId: 137, txHash: '0xdest', txLink: 'https://x/tx/0xdest' }
    )
    expect(context.statusManager.updateExecution).toHaveBeenCalledWith(step, {
      status: 'DONE',
      toAmount: '990000',
    })
  })

  it('marks FAILED without throwing so the caller can resolve', async () => {
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'FAILED', substatus: 'ONRAMP_FAILED' })
    )
    const step = buildStep()
    const context = buildContext(step)

    const result = await new WaitForFundingOrderTask('RECEIVING_CHAIN').run(
      context
    )

    expect(result.status).toBe('COMPLETED')
    expect(context.statusManager.updateAction).toHaveBeenCalledWith(
      step,
      'RECEIVING_CHAIN',
      'FAILED',
      expect.objectContaining({
        error: expect.objectContaining({
          code: LiFiErrorCode.TransactionFailed,
        }),
      })
    )
  })

  it('returns PAUSED on a timeout and leaves the execution resumable', async () => {
    vi.mocked(waitForFundingOrder).mockRejectedValue(
      new SDKError(
        new TransactionError(LiFiErrorCode.Timeout, 'did not reach terminal')
      )
    )
    const step = buildStep()
    const context = buildContext(step)

    const result = await new WaitForFundingOrderTask('RECEIVING_CHAIN').run(
      context
    )

    expect(result.status).toBe('PAUSED')
    expect(context.statusManager.updateExecution).not.toHaveBeenCalledWith(
      step,
      expect.objectContaining({ status: 'FAILED' })
    )
  })

  it('rethrows a non-timeout failure', async () => {
    vi.mocked(waitForFundingOrder).mockRejectedValue(new Error('network down'))
    await expect(
      new WaitForFundingOrderTask('RECEIVING_CHAIN').run(
        buildContext(buildStep())
      )
    ).rejects.toThrowError(/network down/)
  })

  it('throws a ValidationError for a step without fundingOrderId', async () => {
    const step = { id: 'step-1', action: {} } as unknown as LiFiStepExtended
    await expect(
      new WaitForFundingOrderTask('RECEIVING_CHAIN').run(buildContext(step))
    ).rejects.toMatchObject({ code: LiFiErrorCode.ValidationError })
    expect(vi.mocked(waitForFundingOrder)).not.toHaveBeenCalled()
  })
})

describe('WaitForTransactionStatusTask — funding delegation', () => {
  it('routes funding steps to WaitForFundingOrderTask', async () => {
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    const result = await new WaitForTransactionStatusTask(
      'RECEIVING_CHAIN'
    ).run(buildContext(buildStep()))
    expect(result.status).toBe('COMPLETED')
    expect(vi.mocked(waitForFundingOrder)).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 4: Run the spec to verify it fails**

Run: `pnpm --filter @lifi/sdk test:unit -- WaitForFundingOrderTask`
Expected: FAIL on the sentinel, the guarded terminal update, the FAILED no-throw case and the PAUSED timeout case.

- [ ] **Step 5: Rewrite the wait task**

Replace the whole of `packages/sdk/src/core/tasks/WaitForFundingOrderTask.ts`:

```ts
import { waitForFundingOrder } from '../../actions/waitForFundingOrder.js'
import { LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError, ValidationError } from '../../errors/errors.js'
import { SDKError } from '../../errors/SDKError.js'
import type { ExecutionActionType } from '../../types/core.js'
import type { StepExecutorContext, TaskResult } from '../../types/execution.js'
import type {
  FundingExecutionOptions,
  FundingOrder,
} from '../../types/funding.js'
import { isFundingOrderStep } from '../../utils/fundingOrderStep.js'
import { BaseStepExecutionTask } from '../BaseStepExecutionTask.js'

/**
 * Wait slot for funding-order steps. Polls the order (not /status) to a
 * terminal state, reporting the source txHash until the order acknowledges it.
 *
 * A FAILED order is marked, not thrown: executeFundingOrder resolves with the
 * terminal order. A poll timeout returns PAUSED, so the execution stays
 * PENDING and resumable.
 */
export class WaitForFundingOrderTask extends BaseStepExecutionTask {
  readonly actionType: ExecutionActionType

  constructor(actionType: ExecutionActionType) {
    super()
    this.actionType = actionType
  }

  async run(context: StepExecutorContext): Promise<TaskResult> {
    const { client, step, statusManager, isBridgeExecution, toChain } = context
    if (!isFundingOrderStep(step)) {
      throw new ValidationError(
        'WaitForFundingOrderTask requires a step with fundingOrderId.'
      )
    }
    const orderId = step.fundingOrderId

    const sourceAction = statusManager.findAction(
      step,
      isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )

    const action = statusManager.initializeAction({
      step,
      type: this.actionType,
      chainId:
        this.actionType === 'RECEIVING_CHAIN'
          ? step.action.toChainId
          : step.action.fromChainId,
      status: 'PENDING',
    })

    // initializeAction cannot carry a substatus (ActionProps has no such
    // field), and it leaves an existing action's substatus untouched. Write
    // the sentinel explicitly so the Ethereum wait task's chain-check guard
    // treats this step like a normal bridge on every re-entry.
    statusManager.updateAction(step, action.type, 'PENDING', {
      substatus: 'WAIT_DESTINATION_TRANSACTION',
    })

    const fundingOptions = context.executionOptions as
      | FundingExecutionOptions
      | undefined

    // Annotate: an un-annotated `let` assigned only inside try/catch is an
    // implicit any under strict mode.
    let order: FundingOrder
    try {
      order = await waitForFundingOrder(client, orderId, {
        // Re-reported on every non-terminal poll until the order acknowledges
        // it. One failed report can no longer strand the order.
        txHash: sourceAction?.txHash,
        integrator: fundingOptions?.integrator,
        signal: fundingOptions?.signal,
        onUpdate: (updatedOrder) => {
          // The funding substatus is an open string, so it never reaches
          // ExecutionAction.substatus. The caller gets it here instead.
          fundingOptions?.onOrderUpdate?.(updatedOrder)
        },
        // Enforce the 10s floor - non-terminal reads trigger a backend-side
        // refresh, so polling faster just wastes requests.
        pollingInterval: Math.max(
          fundingOptions?.pollingInterval ?? context.pollingIntervalMs ?? 10_000,
          10_000
        ),
        timeout: fundingOptions?.timeout,
      })
    } catch (error) {
      // A timeout is not a failure: the order stays PENDING and the UI keeps
      // the resume path alive. Pausing leaves the execution status untouched,
      // where a throw would let BaseStepExecutor mark it FAILED.
      if (
        error instanceof SDKError &&
        error.code === LiFiErrorCode.Timeout
      ) {
        return { status: 'PAUSED' }
      }
      throw error
    }

    if (order.status === 'FAILED') {
      // Marked, not thrown - the caller resolves with the terminal order.
      statusManager.updateAction(step, action.type, 'FAILED', {
        error: {
          code: LiFiErrorCode.TransactionFailed,
          message: `Funding order ${orderId} failed${
            order.substatus ? ` (${order.substatus})` : ''
          }.`,
        },
      })
      return { status: 'COMPLETED' }
    }

    statusManager.updateAction(step, action.type, 'DONE', {
      chainId: step.action.toChainId,
      // Object.assign in updateAction copies an explicit undefined, so these
      // two must be absent rather than undefined - otherwise a DONE order
      // without toTxHash erases the source hash from a same-chain SWAP action.
      ...(order.result?.toTxHash && {
        txHash: order.result.toTxHash,
        txLink: `${toChain.metamask.blockExplorerUrls[0]}tx/${order.result.toTxHash}`,
      }),
    })

    statusManager.updateExecution(step, {
      status: 'DONE',
      ...(order.result?.toAmount && { toAmount: order.result.toAmount }),
    })

    return { status: 'COMPLETED' }
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @lifi/sdk check:types && pnpm --filter @lifi/sdk test:unit -- WaitForFundingOrderTask`
Expected: PASS, all eleven cases.

- [ ] **Step 7: Run the full suite and the cycle check**

Run: `pnpm --filter @lifi/sdk test:unit && pnpm --filter @lifi/sdk check:circular-deps`
Expected: PASS, no circular dependency.

- [ ] **Step 8: Commit**

```bash
git add packages/sdk/src/types/funding.ts \
        packages/sdk/src/core/fundingExecution.ts \
        packages/sdk/src/core/tasks/WaitForFundingOrderTask.ts \
        packages/sdk/src/core/tasks/WaitForFundingOrderTask.unit.spec.ts
git commit -m "fix(funding): make the wait slot sentinel-aware, non-destructive, and resumable"
```

---

### Task 6: One completion contract, and a resume that cannot double-send

**Findings:** 2, 10, 14.

**The rule: a resolve means the order is terminal. Nothing else resolves.**

The double-send is real because `convertOrderToRoute` produces a step with no `execution`, so `prepareRestart` finds no action with a `txHash` and `EthereumStepExecutor.createPipeline` cannot slice — it restarts from the beginning. The current guard reads `result.fromTxHash`, which the backend sets only after it attributes the transfer, leaving the interval between broadcast and attribution unprotected.

`executeSteps` reaches `if (executedStep.execution?.status !== 'DONE') { stopRouteExecution(route) }` and returns the route, so both the Task 5 FAILED mark and the Task 5 `PAUSED` timeout resolve `executeRoute`. This task decides what the caller then receives.

**Files:**
- Modify: `packages/sdk/src/types/funding.ts` (add `sourceTxHash` to `FundingExecutionOptions`)
- Modify: `packages/sdk/src/core/fundingExecution.ts` (rewrite both entry points)
- Test: `packages/sdk/src/core/fundingExecution.unit.spec.ts`

**Interfaces:**
- Consumes: the Task 5 task results; `FundingExecutionOptions` in `types/funding.ts` (Task 5); `integrator` on `WaitForFundingOrderOptions` (Task 4).
- Produces:
  - `executeFundingOrder(client, order, options?): Promise<FundingOrder>` — resolves only with a terminal order.
  - `resumeFundingOrder(client, order, options?): Promise<FundingOrder>` — same contract.

- [ ] **Step 1: Add the resume hint option**

In `packages/sdk/src/types/funding.ts`, add one field to `FundingExecutionOptions`:

```ts
  /**
   * Source transaction the caller already broadcast, if any. Guards the window
   * between broadcast and backend attribution, where result.fromTxHash is
   * still empty and a rebuilt route would re-send.
   */
  sourceTxHash?: string
```

- [ ] **Step 2: Write the failing tests**

Replace the whole of `packages/sdk/src/core/fundingExecution.unit.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./execution.js', () => ({
  executeRoute: vi.fn(),
  resumeRoute: vi.fn(),
  getActiveRoute: vi.fn(),
}))
vi.mock('../actions/getFundingOrder.js', () => ({
  getFundingOrder: vi.fn(),
}))
vi.mock('../actions/waitForFundingOrder.js', () => ({
  waitForFundingOrder: vi.fn(),
}))

import { buildFundingOrder } from '../actions/fundingOrders.unit.mock.js'
import { getFundingOrder } from '../actions/getFundingOrder.js'
import { waitForFundingOrder } from '../actions/waitForFundingOrder.js'
import { LiFiErrorCode } from '../errors/constants.js'
import { executeRoute, getActiveRoute, resumeRoute } from './execution.js'
import { executeFundingOrder, resumeFundingOrder } from './fundingExecution.js'

const quote = {
  id: 'quote-1',
  action: {
    fromChainId: 1,
    fromAmount: '1000000',
    fromToken: { chainId: 1, address: '0x0', decimals: 6, priceUSD: '1' },
    fromAddress: '0xSender',
    toChainId: 137,
    toToken: { chainId: 137, address: '0x1', decimals: 6, priceUSD: '1' },
    toAddress: '0xReceiver',
  },
  estimate: {
    fromAmountUSD: '1.00',
    toAmount: '990000',
    toAmountMin: '980000',
    toAmountUSD: '0.99',
    approvalAddress: '0xA',
    executionDuration: 30,
  },
  transactionRequest: { to: '0xTo', data: '0xdata' },
  includedSteps: [],
} as any

/** Resolves executeRoute/resumeRoute after firing one terminal transition. */
const fireTerminal = (order: ReturnType<typeof buildFundingOrder>) =>
  vi.fn(async (_client: unknown, _route: unknown, options?: any) => {
    options?.onOrderUpdate?.(order)
    return {} as any
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getActiveRoute).mockReturnValue(undefined)
})

describe('executeFundingOrder', () => {
  it('rejects a FAILED input order', async () => {
    await expect(
      executeFundingOrder({} as any, buildFundingOrder({ status: 'FAILED' }))
    ).rejects.toThrowError(/new order/)
  })

  it('returns a DONE order as-is without executing', async () => {
    const done = buildFundingOrder({ status: 'DONE' })
    await expect(executeFundingOrder({} as any, done)).resolves.toBe(done)
    expect(vi.mocked(executeRoute)).not.toHaveBeenCalled()
  })

  it('resolves with the captured terminal order and makes no extra read', async () => {
    const terminal = buildFundingOrder({ status: 'DONE' })
    vi.mocked(executeRoute).mockImplementation(fireTerminal(terminal))
    const final = await executeFundingOrder(
      {} as any,
      buildFundingOrder({ quote })
    )
    expect(final).toBe(terminal)
    expect(vi.mocked(getFundingOrder)).not.toHaveBeenCalled()
  })

  it('resolves with a FAILED terminal order rather than throwing', async () => {
    const terminal = buildFundingOrder({ status: 'FAILED' })
    vi.mocked(executeRoute).mockImplementation(fireTerminal(terminal))
    const final = await executeFundingOrder(
      {} as any,
      buildFundingOrder({ quote })
    )
    expect(final.status).toBe('FAILED')
  })

  it('rejects with Timeout when the order never reaches a terminal state', async () => {
    vi.mocked(executeRoute).mockResolvedValue({} as any)
    vi.mocked(getFundingOrder).mockResolvedValue(buildFundingOrder())
    await expect(
      executeFundingOrder({} as any, buildFundingOrder({ quote }))
    ).rejects.toMatchObject({ code: LiFiErrorCode.Timeout })
  })

  it('falls back to one read when no transition fired', async () => {
    vi.mocked(executeRoute).mockResolvedValue({} as any)
    vi.mocked(getFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    const final = await executeFundingOrder(
      {} as any,
      buildFundingOrder({ quote })
    )
    expect(final.status).toBe('DONE')
    expect(vi.mocked(getFundingOrder)).toHaveBeenCalledTimes(1)
  })

  it('still forwards the caller onOrderUpdate callback', async () => {
    const terminal = buildFundingOrder({ status: 'DONE' })
    vi.mocked(executeRoute).mockImplementation(fireTerminal(terminal))
    const onOrderUpdate = vi.fn()
    await executeFundingOrder({} as any, buildFundingOrder({ quote }), {
      onOrderUpdate,
    })
    expect(onOrderUpdate).toHaveBeenCalledWith(terminal)
  })

  it.each(['SMART_DEPOSIT', 'ONRAMP'] as const)(
    'only polls for %s orders',
    async (type) => {
      vi.mocked(waitForFundingOrder).mockResolvedValue(
        buildFundingOrder({ status: 'DONE' })
      )
      const final = await executeFundingOrder(
        {} as any,
        buildFundingOrder({ type })
      )
      expect(final.status).toBe('DONE')
      expect(vi.mocked(executeRoute)).not.toHaveBeenCalled()
    }
  )
})

describe('resumeFundingOrder', () => {
  it('returns immediately when the refreshed order is terminal', async () => {
    vi.mocked(getFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    const final = await resumeFundingOrder({} as any, buildFundingOrder())
    expect(final.status).toBe('DONE')
    expect(vi.mocked(resumeRoute)).not.toHaveBeenCalled()
  })

  it('resumes the live route when one is still in memory', async () => {
    const terminal = buildFundingOrder({ status: 'DONE' })
    const live = { id: 'order-1', steps: [] } as any
    vi.mocked(getFundingOrder).mockResolvedValue(buildFundingOrder({ quote }))
    vi.mocked(getActiveRoute).mockReturnValue(live)
    vi.mocked(resumeRoute).mockImplementation(fireTerminal(terminal))

    const final = await resumeFundingOrder({} as any, buildFundingOrder())

    expect(vi.mocked(resumeRoute).mock.calls[0][1]).toBe(live)
    expect(final.status).toBe('DONE')
  })

  it('polls only when the order already reports a source transaction', async () => {
    vi.mocked(getFundingOrder).mockResolvedValue(
      buildFundingOrder({ quote, result: { fromTxHash: '0xsent' } })
    )
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    const final = await resumeFundingOrder({} as any, buildFundingOrder())
    expect(final.status).toBe('DONE')
    expect(vi.mocked(resumeRoute)).not.toHaveBeenCalled()
    expect(vi.mocked(executeRoute)).not.toHaveBeenCalled()
  })

  it('polls only when the caller supplies sourceTxHash, and reports it', async () => {
    vi.mocked(getFundingOrder).mockResolvedValue(buildFundingOrder({ quote }))
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    const final = await resumeFundingOrder({} as any, buildFundingOrder(), {
      sourceTxHash: '0xbroadcast',
    })
    expect(final.status).toBe('DONE')
    expect(vi.mocked(resumeRoute)).not.toHaveBeenCalled()
    expect(vi.mocked(waitForFundingOrder)).toHaveBeenCalledWith(
      expect.anything(),
      'order-1',
      expect.objectContaining({ txHash: '0xbroadcast' })
    )
  })

  it('rebuilds and resumes only when nothing was sent yet', async () => {
    const terminal = buildFundingOrder({ status: 'DONE' })
    vi.mocked(getFundingOrder).mockResolvedValue(buildFundingOrder({ quote }))
    vi.mocked(resumeRoute).mockImplementation(fireTerminal(terminal))
    const final = await resumeFundingOrder({} as any, buildFundingOrder())
    expect(vi.mocked(resumeRoute)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(resumeRoute).mock.calls[0][1].id).toBe('order-1')
    expect(final.status).toBe('DONE')
  })

  it('scopes the refresh with integrator', async () => {
    vi.mocked(getFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    await resumeFundingOrder({} as any, buildFundingOrder(), {
      integrator: 'jumper',
    })
    expect(vi.mocked(getFundingOrder)).toHaveBeenCalledWith(
      expect.anything(),
      'order-1',
      { integrator: 'jumper' }
    )
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @lifi/sdk test:unit -- fundingExecution`
Expected: FAIL — `getActiveRoute` is not mocked in the module today, no capture wrapper exists, and `sourceTxHash` is not read.

- [ ] **Step 4: Rewrite both entry points**

Replace the whole of `packages/sdk/src/core/fundingExecution.ts`:

```ts
import { getFundingOrder } from '../actions/getFundingOrder.js'
import { waitForFundingOrder } from '../actions/waitForFundingOrder.js'
import { LiFiErrorCode } from '../errors/constants.js'
import { TransactionError, ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import type { Route } from '@lifi/types'
import type { SDKClient } from '../types/core.js'
import type {
  FundingExecutionOptions,
  FundingOrder,
} from '../types/funding.js'
import { convertOrderToRoute } from '../utils/convertOrderToRoute.js'
import { executeRoute, getActiveRoute, resumeRoute } from './execution.js'

export type { FundingExecutionOptions } from '../types/funding.js'

const isTerminal = (order: FundingOrder | undefined): boolean =>
  order?.status === 'DONE' || order?.status === 'FAILED'

const waitOnly = async (
  client: SDKClient,
  order: FundingOrder,
  options?: FundingExecutionOptions,
  sourceTxHash?: string
): Promise<FundingOrder> =>
  waitForFundingOrder(client, order.orderId, {
    pollingInterval: options?.pollingInterval,
    timeout: options?.timeout,
    integrator: options?.integrator,
    signal: options?.signal,
    txHash: sourceTxHash,
    onUpdate: options?.onOrderUpdate,
  })

/**
 * Run a route through the pipeline and return the terminal order.
 * The terminal order arrives through the onOrderUpdate capture, so no extra
 * read is needed on the common path.
 */
const runAndCapture = async (
  client: SDKClient,
  route: Route,
  orderId: string,
  options: FundingExecutionOptions | undefined,
  run: (
    client: SDKClient,
    route: Route,
    options?: FundingExecutionOptions
  ) => Promise<unknown>
): Promise<FundingOrder> => {
  let latest: FundingOrder | undefined
  await run(client, route, {
    ...options,
    onOrderUpdate: (order: FundingOrder) => {
      latest = order
      options?.onOrderUpdate?.(order)
    },
  })
  if (isTerminal(latest)) {
    return latest!
  }
  // No transition fired - read once before giving up.
  const refetched = await getFundingOrder(client, orderId, {
    ...(options?.integrator && { integrator: options.integrator }),
  })
  if (isTerminal(refetched)) {
    return refetched
  }
  // The execution stopped before a terminal state: a poll timeout, a PAUSED
  // task under executeInBackground, or stopRouteExecution. All three mean the
  // same thing to the caller - resume later.
  throw new SDKError(
    new TransactionError(
      LiFiErrorCode.Timeout,
      `Funding order ${orderId} execution stopped before a terminal state. Resume it.`
    )
  )
}

/**
 * Execute a funding order. STANDARD orders run through the standard route
 * execution pipeline (allowance, sign, send) and then track the order to a
 * terminal state. SMART_DEPOSIT and ONRAMP orders only poll - rendering the
 * deposit QR or the on-ramp widget is the caller's job.
 *
 * A resolve always means the order is terminal, DONE or FAILED, for every
 * order type. Check `order.status` to tell them apart.
 * @param client - The SDK client.
 * @param order - The funding order to execute. Must not be FAILED.
 * @param options - Execution options, including route execution hooks for STANDARD orders.
 * @throws {SDKError} ValidationError for a FAILED input order - create a new order instead. TransactionError with LiFiErrorCode.Timeout when the execution stops before a terminal order; the order stays PENDING and can be resumed.
 * @returns The terminal funding order, DONE or FAILED.
 */
export const executeFundingOrder = async (
  client: SDKClient,
  order: FundingOrder,
  options?: FundingExecutionOptions
): Promise<FundingOrder> => {
  if (order.status === 'FAILED') {
    throw new SDKError(
      new ValidationError(
        `Funding order ${order.orderId} is FAILED. Create a new order with a new partnerOrderId instead.`
      )
    )
  }
  if (order.status === 'DONE') {
    return order
  }
  if (order.type !== 'STANDARD') {
    return waitOnly(client, order, options)
  }
  return runAndCapture(
    client,
    convertOrderToRoute(order),
    order.orderId,
    options,
    executeRoute
  )
}

/**
 * Resume a funding order. Re-reads the order first, then takes the first
 * layer that applies:
 *
 * 1. terminal order - return it;
 * 2. a live in-memory route - resume that, so provider resume-slicing works;
 * 3. a source transaction already exists (reported by the order, or supplied
 *    as `options.sourceTxHash`) - poll only, never re-send;
 * 4. nothing sent yet - rebuild the route and resume.
 *
 * Layer 3 needs `sourceTxHash` because the backend sets `result.fromTxHash`
 * only after it attributes the transfer. Without it, a reload inside that
 * window would send the funding transaction a second time.
 *
 * A resolve always means the order is terminal, DONE or FAILED.
 * @param client - The SDK client.
 * @param order - The funding order to resume.
 * @param options - Execution options. Pass `sourceTxHash` when the caller persisted one.
 * @throws {SDKError} TransactionError with LiFiErrorCode.Timeout when the execution stops before a terminal order; the order stays PENDING and can be resumed again.
 * @returns The terminal funding order, DONE or FAILED.
 */
export const resumeFundingOrder = async (
  client: SDKClient,
  order: FundingOrder,
  options?: FundingExecutionOptions
): Promise<FundingOrder> => {
  const fresh = await getFundingOrder(client, order.orderId, {
    ...(options?.integrator && { integrator: options.integrator }),
  })
  if (isTerminal(fresh)) {
    return fresh
  }

  const live = getActiveRoute(fresh.orderId)
  if (live) {
    return runAndCapture(client, live, fresh.orderId, options, resumeRoute)
  }

  const sourceTxHash = fresh.result?.fromTxHash ?? options?.sourceTxHash
  if (fresh.type !== 'STANDARD' || sourceTxHash) {
    return waitOnly(client, fresh, options, sourceTxHash)
  }

  return runAndCapture(
    client,
    convertOrderToRoute(fresh),
    fresh.orderId,
    options,
    resumeRoute
  )
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @lifi/sdk check:types && pnpm --filter @lifi/sdk test:unit -- fundingExecution`
Expected: PASS.

- [ ] **Step 6: Run the full suite and the cycle check**

Run: `pnpm --filter @lifi/sdk test:unit && pnpm --filter @lifi/sdk check:circular-deps`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/types/funding.ts \
        packages/sdk/src/core/fundingExecution.ts \
        packages/sdk/src/core/fundingExecution.unit.spec.ts
git commit -m "fix(funding): resolve only with terminal orders and guard resume against double sends"
```

---

### Task 7: Narrow the 422 classification

**Findings:** 8.

This reverses a deliberate choice. Plan Task 2 of the predecessor plan, committed as `7d675607`, picked `TransactionConflict` on purpose to carry the idempotency-conflict meaning of a 422 from `POST /v1/funding/orders`. The intent was right; the mechanism was too broad. `statusCodeToErrorClassificationMap` applies to every endpoint, and `parseBitcoinErrors` already produces `LiFiErrorCode.TransactionConflict` (1020) for a real mempool conflict. The funding meaning moves to the funding action, where it belongs.

**Files:**
- Modify: `packages/sdk/src/errors/httpError.ts:29-35`
- Modify: `packages/sdk/src/actions/createFundingOrder.ts:14,26-40`
- Test: `packages/sdk/src/errors/httpError.unit.spec.ts`
- Test: `packages/sdk/src/actions/createFundingOrder.unit.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: HTTP 422 resolves to `LiFiErrorCode.ValidationError` on every endpoint. `createFundingOrder` rejects a 422 with a message containing `partnerOrderId`.

- [ ] **Step 1: Write the failing tests**

In `packages/sdk/src/errors/httpError.unit.spec.ts`, replace the `it('classifies 422 as a conflict', ...)` case:

```ts
  it('classifies 422 as a validation error, not a transaction conflict', () => {
    const error = new HTTPError(
      makeResponse(422, 'Unprocessable Entity'),
      'https://li.quest/v1/funding/orders',
      {}
    )
    expect(error.type).toBe(ErrorName.ValidationError)
    expect(error.code).toBe(LiFiErrorCode.ValidationError)
    // 1020 is already taken by parseBitcoinErrors for a real mempool conflict.
    expect(error.code).not.toBe(LiFiErrorCode.TransactionConflict)
  })
```

Append to `packages/sdk/src/actions/createFundingOrder.unit.spec.ts`, inside its `describe('createFundingOrder', ...)` block. That file already imports `http` and `HttpResponse` from `msw`, already calls `const server = setupTestServer()`, and already defines the `params` object this test reuses — no new imports are needed:

```ts
  it('names partnerOrderId reuse when the server returns 422', async () => {
    server.use(
      http.post(`${client.config.apiUrl}/funding/orders`, async () =>
        HttpResponse.json({ message: 'conflict' }, { status: 422 })
      )
    )
    await expect(createFundingOrder(client, params)).rejects.toThrowError(
      /partnerOrderId/
    )
  })

  it('leaves non-422 failures untranslated', async () => {
    server.use(
      http.post(`${client.config.apiUrl}/funding/orders`, async () =>
        HttpResponse.json({ message: 'provider down' }, { status: 424 })
      )
    )
    await expect(createFundingOrder(client, params)).rejects.not.toThrowError(
      /partnerOrderId/
    )
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @lifi/sdk test:unit -- httpError createFundingOrder`
Expected: FAIL — 422 still maps to `TransactionConflict`, and `createFundingOrder` rejects with the generic HTTP message.

- [ ] **Step 3: Narrow the global map entry**

In `packages/sdk/src/errors/httpError.ts`, replace the 422 entry:

```ts
  [
    422,
    {
      type: ErrorName.ValidationError,
      code: LiFiErrorCode.ValidationError,
    },
  ],
```

- [ ] **Step 4: Move the funding meaning to the action**

In `packages/sdk/src/actions/createFundingOrder.ts`, add the imports it needs:

```ts
import { HTTPError } from '../errors/httpError.js'
```

Then replace the `return await request<FundingOrder>(...)` call with a wrapped version, and update the JSDoc `@throws` line:

```ts
 * @throws {SDKError} ValidationError when partnerOrderId is missing, or when the server rejects the body with 422 (partnerOrderId reuse with a different body). 424 wraps ThirdPartyError (on-ramp provider outage), 401 wraps ValidationError (keyless ONRAMP).
```

```ts
  try {
    return await request<FundingOrder>(
      client.config,
      `${client.config.apiUrl}/funding/orders`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: options?.signal,
      }
    )
  } catch (error: unknown) {
    const cause = (error as SDKError).cause
    if (cause instanceof HTTPError && cause.status === 422) {
      // SDKError's constructor is (cause, step?, action?) - there is no slot
      // for a nested error, so do not pass the original as a second argument.
      throw new SDKError(
        new ValidationError(
          `Funding order ${params.partnerOrderId} was rejected: this partnerOrderId was already used with a different request body. Use a new partnerOrderId, or replay the original body byte-for-byte.`
        )
      )
    }
    throw error
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @lifi/sdk check:types && pnpm --filter @lifi/sdk test:unit -- httpError createFundingOrder`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `pnpm --filter @lifi/sdk test:unit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/errors/httpError.ts \
        packages/sdk/src/errors/httpError.unit.spec.ts \
        packages/sdk/src/actions/createFundingOrder.ts \
        packages/sdk/src/actions/createFundingOrder.unit.spec.ts
git commit -m "fix(funding): classify 422 as a validation error and name partnerOrderId reuse"
```

---

### Task 8: Amend the changeset and verify the whole branch

**Files:**
- Modify: `.changeset/funding-orders-surface.md`

**Interfaces:**
- Consumes: every earlier task.
- Produces: a branch ready for review.

- [ ] **Step 1: Amend the changeset**

Both packages stay **minor**: the funding surface is unreleased, so every change in this plan lands before the first publish. Do not add a second changeset file.

Replace the body of `.changeset/funding-orders-surface.md` below the front matter:

```markdown
Add the unified funding orders surface: funding order types, `createFundingOrder`, `getFundingOrder`, `waitForFundingOrder`, the on-ramp/CEX helper actions, and `executeFundingOrder`/`resumeFundingOrder`, which run STANDARD orders through the existing route execution pipeline via `convertOrderToRoute`. Funding steps restore their committed quote from the order, opt out of the Permit2 path, and track status against the order endpoint. `executeFundingOrder` and `resumeFundingOrder` resolve only with a terminal order (DONE or FAILED) and reject with `LiFiErrorCode.Timeout` when execution stops earlier, so a single observer covers every funding source. `resumeFundingOrder` accepts `sourceTxHash` to avoid re-sending a funding transaction the backend has not attributed yet. `waitForFundingOrder` accepts `signal`, `integrator` and `txHash`. HTTP 401 and 422 responses are now classified as `LiFiErrorCode.ValidationError` across all endpoints (previously `InternalError`).
```

- [ ] **Step 2: Confirm the front matter is unchanged**

Run: `head -5 .changeset/funding-orders-surface.md`
Expected:

```
---
'@lifi/sdk': minor
'@lifi/sdk-provider-ethereum': minor
---
```

- [ ] **Step 3: Run every gate**

Run each in turn and read the output. Do not proceed past a failure.

```bash
pnpm check
pnpm check:types
pnpm check:circular-deps
pnpm knip:check
pnpm --filter @lifi/sdk test:unit
pnpm --filter @lifi/sdk-provider-ethereum test:unit
```

Expected: all six PASS. The `@lifi/sdk` suite should report more tests than the 278 it had before this plan.

- [ ] **Step 4: Confirm no stray `as any` substatus cast survives**

Run: `grep -rn "substatus.*as any" packages/sdk/src packages/sdk-provider-ethereum/src`
Expected: no matches. Both casts were removed in Task 5.

- [ ] **Step 5: Confirm the version files are still untouched**

Run: `git status --short packages/*/src/version.ts`
Expected: exactly six ` M` lines and nothing staged. These are unrelated working-tree changes that must not enter any commit.

- [ ] **Step 6: Commit**

```bash
git add .changeset/funding-orders-surface.md
git commit -m "docs(funding): describe the post-review fixes in the changeset"
```

---

## Verification Summary

| Finding | Task | Spec section |
|---|---|---|
| 1 — discarded permit causes a revert | 2, 3 | §5.1, §5.2, §8.1 |
| 2 — resume can double-send | 6 | §7.1 |
| 3 — terminal update erases the source txHash | 5 | §7.3 |
| 4 — predicate at one decision point | closed, no task | §3.1 |
| 5 — prepare slots diverged | 3 | §8.1 |
| 6 — timeout marks the execution FAILED | 5 | §6.2 |
| 7 — substatus trips the chain-check guard | 5 | §7.2 |
| 8 — 422 collides with the Bitcoin conflict code | 7 | §8.2 |
| 9 — no `AbortSignal` | 4 | §7.5 |
| 10 — can resolve with a PENDING order | 6 | §6.3 |
| 11 — source-tx report swallowed once | 4, 5 | §7.4 |
| 12 — keyless lookups cannot be polled | 4, 6 | §7.5 |
| 13 — `convertOrderToRoute` mutates its input | 2 | §5.1 |
| 14 — asymmetric FAILED contract | 5, 6 | §6.1, §6.4 |
| 15 — predicate does not narrow | 1 | §5.4 |

Out of scope, tracked in spec §9: the widget needs a `sourceTxHash` field in its thin localStorage list, and its single completion observer changes shape now that a FAILED order resolves. Both live in the `widget` repo and need their own spec.
