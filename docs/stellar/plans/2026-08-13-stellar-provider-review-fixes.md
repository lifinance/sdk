# Stellar Provider Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 14 findings from the PR 427 code review on `feat/stellar-provider`, so the Stellar provider can merge.

**Architecture:** One `main` sync, then six themed commits. The only shared-SDK change is a new protected hook on `PrepareTransactionTask`, which lets `StellarPrepareTransactionTask` stop being a copy of it. Everything else is local to `@lifi/sdk-provider-stellar`: error classification order, submit/confirm resilience, approval resolution and re-validation, and the public type surface.

**Tech Stack:** TypeScript (ESM, `isolatedDeclarations`), pnpm workspaces, vitest, biome, Changesets, `@stellar/stellar-sdk` 16.1.0.

**Design:** `docs/stellar/specs/2026-08-13-stellar-provider-review-fixes-design.md`. Section references below (§5–§10) point into it.

## Global Constraints

- **Worktree:** `/Users/eugene/Projects/sdk-stellar-review`, branch `feat/stellar-provider`. All commands run from the worktree root unless a path says otherwise.
- **Verification gate, run before every commit, in this order** (it mirrors `.github/workflows/tests.yaml`):
  ```bash
  pnpm check:write && pnpm build && pnpm check:types && pnpm test
  ```
  `pnpm build` must precede `pnpm test`: the provider packages resolve `@lifi/sdk` to `packages/sdk/dist`. There is no `pnpm lint`.
- **`pnpm build` rewrites six generated files.** After every build, and immediately before every `git add`, restore them:
  ```bash
  git checkout -- packages/sdk/src/version.ts \
    packages/sdk-provider-bitcoin/src/version.ts \
    packages/sdk-provider-ethereum/src/version.ts \
    packages/sdk-provider-solana/src/version.ts \
    packages/sdk-provider-sui/src/version.ts \
    packages/sdk-provider-tron/src/version.ts
  ```
  Never `git add -A`. Stage the exact paths each task lists. `packages/sdk-provider-stellar/src/version.ts` is the one generated version file that belongs on this branch.
- **Husky runs on every commit.** `pre-commit` runs `pnpm pre-commit` (`check`, `check:types`, `check:circular-deps`, `knip:check`); `commit-msg` runs commitlint, so every commit subject must be conventional (`fix(stellar): ...`).
- **`isolatedDeclarations: true`** — every exported symbol needs an explicit return type annotation.
- **No default exports** in library code.
- **Unit tests only.** Do not un-skip `getStellarBalance.int.spec.ts`. Do not add CI secrets.
- **Test file naming:** `<module>.unit.spec.ts`, beside the module it tests.
- **Stellar test fixtures:** build contract addresses with `StrKey.encodeContract(Buffer.alloc(32, N))` and wallet addresses with `Keypair.random().publicKey()`, as `resolveApprovalRequirement.unit.spec.ts` already does.

---

### Task 0: Sync `main` into the branch

**Files:**
- Modify: whatever the merge touches (the trial merge is clean — `git merge-tree --write-tree origin/main HEAD` reports no conflicts)

**Interfaces:**
- Consumes: nothing
- Produces: `packages/sdk/src/core/tasks/PrepareTransactionTask.ts` containing the funding-order branch that Task 2 hooks into

- [ ] **Step 1: Fetch and confirm the merge is still clean**

```bash
git fetch origin main
git merge-tree --write-tree --name-only origin/main HEAD
```

Expected: a single 40-character tree OID and no file list. A list of paths means conflicts appeared since this plan was written — resolve them in Step 2 by hand, keeping both sides' intent.

- [ ] **Step 2: Merge**

```bash
git merge origin/main -m "Merge branch 'main' into feat/stellar-provider"
```

- [ ] **Step 3: Confirm the base task now has the funding-order branch**

```bash
grep -n "isFundingOrderStep" packages/sdk/src/core/tasks/PrepareTransactionTask.ts
```

Expected: a hit around line 35. This is what Task 2 modifies, and its absence means the merge did not take.

- [ ] **Step 4: Run the gate**

```bash
pnpm install
pnpm check:write && pnpm build && pnpm check:types && pnpm test
```

Expected: all packages build, types check, every suite passes.

- [ ] **Step 5: Restore the generated version files**

```bash
git checkout -- packages/sdk/src/version.ts \
  packages/sdk-provider-bitcoin/src/version.ts \
  packages/sdk-provider-ethereum/src/version.ts \
  packages/sdk-provider-solana/src/version.ts \
  packages/sdk-provider-sui/src/version.ts \
  packages/sdk-provider-tron/src/version.ts
git status --short
```

Expected: clean, apart from a possible `pnpm-lock.yaml` change from the merge. If the lockfile changed, `git add pnpm-lock.yaml && git commit --amend --no-edit`.

---

### Task 1: Drop the unrelated generated version files (§5)

**Files:**
- Modify: `packages/sdk/src/version.ts`, `packages/sdk-provider-bitcoin/src/version.ts`, `packages/sdk-provider-ethereum/src/version.ts`, `packages/sdk-provider-solana/src/version.ts`, `packages/sdk-provider-sui/src/version.ts`, `packages/sdk-provider-tron/src/version.ts` — restore each to `origin/main`'s content
- Test: none. These files are build output; no behaviour changes.

**Interfaces:**
- Consumes: nothing
- Produces: a PR diff limited to the packages the PR actually changes

- [ ] **Step 1: See what the PR currently claims**

```bash
git diff origin/main...HEAD --stat -- "*version.ts"
```

Expected: seven files. Six of them (`sdk`, `bitcoin`, `ethereum`, `solana`, `sui`, `tron`) are a local build's output and do not belong in this PR. `sdk-provider-stellar` is a new file the package needs to build, and it stays.

- [ ] **Step 2: Restore the six files to `main`'s content**

```bash
git checkout origin/main -- packages/sdk/src/version.ts \
  packages/sdk-provider-bitcoin/src/version.ts \
  packages/sdk-provider-ethereum/src/version.ts \
  packages/sdk-provider-solana/src/version.ts \
  packages/sdk-provider-sui/src/version.ts \
  packages/sdk-provider-tron/src/version.ts
```

- [ ] **Step 3: Verify only the Stellar file remains**

```bash
git diff origin/main...HEAD --stat -- "*version.ts"
git diff --cached --stat -- "*version.ts"
```

Expected: the first command lists only `packages/sdk-provider-stellar/src/version.ts` once the change is committed; the second shows the six restored files staged.

- [ ] **Step 4: Run the gate**

```bash
pnpm check:write && pnpm build && pnpm check:types && pnpm test
```

Expected: everything passes. `pnpm build` rewrites the six files again — that is normal and does not undo the fix.

- [ ] **Step 5: Re-restore, then commit**

The build in Step 4 dirtied the six files. Restore them from `origin/main` again, then commit exactly those paths.

```bash
git checkout origin/main -- packages/sdk/src/version.ts \
  packages/sdk-provider-bitcoin/src/version.ts \
  packages/sdk-provider-ethereum/src/version.ts \
  packages/sdk-provider-solana/src/version.ts \
  packages/sdk-provider-sui/src/version.ts \
  packages/sdk-provider-tron/src/version.ts
git add packages/sdk/src/version.ts \
  packages/sdk-provider-bitcoin/src/version.ts \
  packages/sdk-provider-ethereum/src/version.ts \
  packages/sdk-provider-solana/src/version.ts \
  packages/sdk-provider-sui/src/version.ts \
  packages/sdk-provider-tron/src/version.ts
git commit -m "chore(stellar): keep generated version files out of the PR"
```

---

### Task 2: Add the refetch hook and make the Stellar task a subclass (§6)

**Files:**
- Modify: `packages/sdk/src/core/tasks/PrepareTransactionTask.ts`
- Create: `packages/sdk/src/core/tasks/PrepareTransactionTask.unit.spec.ts`
- Modify: `packages/sdk-provider-stellar/src/core/tasks/StellarPrepareTransactionTask.ts` (replace the whole file)
- Modify: `packages/sdk-provider-stellar/src/core/tasks/StellarPrepareTransactionTask.unit.spec.ts` (replace the whole file)
- Modify: `.changeset/stellar-provider.md`

**Interfaces:**
- Consumes: `PrepareTransactionTask` exported from `@lifi/sdk` (already in `packages/sdk/src/index.ts`)
- Produces:
  - `PrepareTransactionTask.prototype.shouldRefetchTransaction(context: StepExecutorContext): boolean` — protected, default `!context.step.transactionRequest`
  - `class StellarPrepareTransactionTask extends PrepareTransactionTask` — overrides the hook to `true`. Task 5 adds a `run()` override to this same class.

- [ ] **Step 1: Write the failing base-task test**

Create `packages/sdk/src/core/tasks/PrepareTransactionTask.unit.spec.ts`. The mocks use the base task's own relative import paths — mocking `@lifi/sdk` would not intercept them.

```ts
import type { LiFiStep } from '@lifi/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../actions/getStepTransaction.js', () => ({
  getStepTransaction: vi.fn(async () => ({
    transactionRequest: { data: '0xfresh' },
  })),
}))
vi.mock('./helpers/stepComparison.js', () => ({
  stepComparison: vi.fn(async (_sm: unknown, _old: unknown, updated: unknown) => updated),
}))

import { getStepTransaction } from '../../actions/getStepTransaction.js'
import type { StepExecutorContext } from '../../types/execution.js'
import { PrepareTransactionTask } from './PrepareTransactionTask.js'

/** A provider whose payload can never be reused, as Stellar's cannot. */
class AlwaysRefetchTask extends PrepareTransactionTask {
  protected override shouldRefetchTransaction(): boolean {
    return true
  }
}

const buildStep = (transactionRequest?: object): LiFiStep =>
  ({
    id: 'step-1',
    action: { fromChainId: 1 },
    estimate: {},
    transactionRequest,
  }) as unknown as LiFiStep

const buildContext = (step: LiFiStep): StepExecutorContext =>
  ({
    client: {} as any,
    step,
    statusManager: {
      findAction: () => ({ type: 'SWAP' }),
      updateAction: vi.fn(),
    } as any,
    allowUserInteraction: true,
    isBridgeExecution: false,
  }) as unknown as StepExecutorContext

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PrepareTransactionTask — refetch hook', () => {
  it('does not refetch by default when the step already carries a request', async () => {
    await new PrepareTransactionTask().run(
      buildContext(buildStep({ data: '0xstale' }))
    )

    expect(getStepTransaction).not.toHaveBeenCalled()
  })

  it('refetches by default when the step carries no request', async () => {
    await new PrepareTransactionTask().run(buildContext(buildStep()))

    expect(getStepTransaction).toHaveBeenCalledTimes(1)
  })

  // Locks the contract the Stellar provider relies on. Without the hook the
  // guard below would skip the refetch and sign a stale envelope.
  it('refetches when a subclass forces it, even with a request present', async () => {
    const step = buildStep({ data: '0xstale' })

    await new AlwaysRefetchTask().run(buildContext(step))

    expect(getStepTransaction).toHaveBeenCalledTimes(1)
    expect((step.transactionRequest as { data: string }).data).toBe('0xfresh')
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
pnpm --filter @lifi/sdk test PrepareTransactionTask.unit.spec.ts
```

Expected: the third test FAILS — `getStepTransaction` was never called, because the hook does not exist yet and the base guard sees a `transactionRequest`. The first two pass already.

- [ ] **Step 3: Add the hook to the base task**

In `packages/sdk/src/core/tasks/PrepareTransactionTask.ts`, add the method as the first member of the class, above `run()`:

```ts
  /**
   * Whether `run()` has to fetch a fresh transaction request. The default asks
   * only when the step carries none, which keeps every existing provider
   * unchanged. Chains whose payload cannot be reused override it — see
   * `StellarPrepareTransactionTask`.
   */
  protected shouldRefetchTransaction(context: StepExecutorContext): boolean {
    return !context.step.transactionRequest
  }
```

Then replace the single guard line inside `run()`:

```ts
    if (!step.transactionRequest) {
```

with:

```ts
    if (this.shouldRefetchTransaction(context)) {
```

Change nothing else. The funding-order branch and the re-quote branch inside the guard stay exactly as they are.

- [ ] **Step 4: Run the base-task test to verify it passes**

```bash
pnpm --filter @lifi/sdk test PrepareTransactionTask.unit.spec.ts
```

Expected: 3 passed.

- [ ] **Step 5: Replace the Stellar task with a subclass**

Replace the entire contents of `packages/sdk-provider-stellar/src/core/tasks/StellarPrepareTransactionTask.ts`:

```ts
import { PrepareTransactionTask } from '@lifi/sdk'

/**
 * Always re-fetches the step transaction, where the base task asks only when
 * the step carries none.
 *
 * A Stellar envelope is not a reusable payload: the backend embeds the sender's
 * account sequence number and timebounds `[0, now + 300s]` at build time.
 *
 * 1. Approvals. `StellarSetAllowanceTask` submits a transaction of its own,
 *    which consumes the sender's sequence number. Any envelope built before
 *    that approval is invalid (`tx_bad_seq`), so the envelope has to be
 *    requested after it — which only happens if this task always asks for a
 *    fresh one.
 * 2. Staleness. On the quote path `convertQuoteToRoute` carries the quote's
 *    `transactionRequest` into the route, so the base guard would never
 *    re-fetch and would sign an envelope minted minutes earlier — expiring as
 *    `tx_too_late` once the user lingers in their wallet.
 *
 * The `getRoutes` path never carries a `transactionRequest`, and `resumeRoute`
 * clears it through `prepareRestart`, so the base guard already re-fetches for
 * both. This override is what covers the quote path.
 */
export class StellarPrepareTransactionTask extends PrepareTransactionTask {
  protected override shouldRefetchTransaction(): boolean {
    return true
  }
}
```

- [ ] **Step 6: Replace the Stellar task's test**

The old test drove the whole `run()` body by mocking `getStepTransaction` on the `@lifi/sdk` package surface. That no longer works: the base task lives inside `@lifi/sdk` and calls its own internal import, which a package-level mock cannot reach. Task 2 Step 1 covers that behaviour in the sdk package instead. This test now covers the override itself.

Replace the entire contents of `packages/sdk-provider-stellar/src/core/tasks/StellarPrepareTransactionTask.unit.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const baseRun = vi.fn(async () => ({ status: 'COMPLETED' }))

// Stub the base class so this suite tests the override, not the shared task.
// `PrepareTransactionTask.unit.spec.ts` in @lifi/sdk covers the base body.
vi.mock('@lifi/sdk', async () => {
  const actual = await vi.importActual<typeof import('@lifi/sdk')>('@lifi/sdk')
  class PrepareTransactionTask {
    protected shouldRefetchTransaction(_context: unknown): boolean {
      return false
    }
    async run(context: unknown): Promise<unknown> {
      return baseRun(context as never)
    }
  }
  return { ...actual, PrepareTransactionTask }
})

const { StellarPrepareTransactionTask } = await import(
  './StellarPrepareTransactionTask.js'
)

const refetchDecision = (task: object): boolean =>
  (
    task as unknown as {
      shouldRefetchTransaction: (context: unknown) => boolean
    }
  ).shouldRefetchTransaction({ step: { transactionRequest: { data: 'x' } } })

describe('StellarPrepareTransactionTask', () => {
  beforeEach(() => {
    baseRun.mockClear()
  })

  // The whole reason this subclass exists. A Stellar envelope embeds the
  // sender's sequence number and short timebounds, so reusing one is never
  // correct — not even when the step already carries it.
  it('always asks the base task to re-fetch', () => {
    expect(refetchDecision(new StellarPrepareTransactionTask())).toBe(true)
  })

  it('returns what the base task returns', async () => {
    const context = { step: {} } as never

    const result = await new StellarPrepareTransactionTask().run(context)

    expect(baseRun).toHaveBeenCalledWith(context)
    expect(result).toEqual({ status: 'COMPLETED' })
  })
})
```

- [ ] **Step 7: Run the Stellar suite**

```bash
pnpm --filter @lifi/sdk build
pnpm --filter @lifi/sdk-provider-stellar test
```

Expected: every Stellar suite passes, including the two new prepare tests.

- [ ] **Step 8: Record the hook in the changeset**

Append this paragraph to `.changeset/stellar-provider.md`, after the existing text:

```markdown
`PrepareTransactionTask` gains a `shouldRefetchTransaction` hook. It defaults to the previous behaviour — fetch only when the step carries no transaction request — and the Stellar task overrides it, because a Stellar envelope embeds the sender's sequence number and cannot be reused.
```

- [ ] **Step 9: Run the gate and commit**

```bash
pnpm check:write && pnpm build && pnpm check:types && pnpm test
git checkout -- packages/sdk/src/version.ts \
  packages/sdk-provider-bitcoin/src/version.ts \
  packages/sdk-provider-ethereum/src/version.ts \
  packages/sdk-provider-solana/src/version.ts \
  packages/sdk-provider-sui/src/version.ts \
  packages/sdk-provider-tron/src/version.ts
git add packages/sdk/src/core/tasks/PrepareTransactionTask.ts \
  packages/sdk/src/core/tasks/PrepareTransactionTask.unit.spec.ts \
  packages/sdk-provider-stellar/src/core/tasks/StellarPrepareTransactionTask.ts \
  packages/sdk-provider-stellar/src/core/tasks/StellarPrepareTransactionTask.unit.spec.ts \
  .changeset/stellar-provider.md
git commit -m "refactor(sdk): add a refetch hook to PrepareTransactionTask"
```

---

### Task 3: Keep classified errors classified (§7)

**Files:**
- Modify: `packages/sdk-provider-stellar/src/errors/parseStellarErrors.ts`
- Modify: `packages/sdk-provider-stellar/src/errors/parseStellarErrors.unit.spec.ts` (add three cases)
- Modify: `packages/sdk-provider-stellar/src/core/tasks/helpers/readAllowance.ts` (replace the whole file)
- Create: `packages/sdk-provider-stellar/src/core/tasks/helpers/readAllowance.unit.spec.ts`

**Interfaces:**
- Consumes: `callStellarRpcsWithRetry(client, fn)` from `../../../client/getStellarRpc.js`
- Produces: `readAllowance(client, token, from, spender, networkPassphrase): Promise<bigint>` — signature unchanged; it now throws a classified `TransactionError` that survives `parseStellarErrors`.

Ship all three changes together. Fixing `readAllowance` alone is a regression: the freed `TransactionError` would reach the `allowance` message match and come back as a confident, wrong `AllowanceRequired`.

- [ ] **Step 1: Write the failing classification tests**

Append to `packages/sdk-provider-stellar/src/errors/parseStellarErrors.unit.spec.ts`, inside the existing `describe`:

```ts
  // The provider classifies its own failures on purpose. Message matching must
  // not re-code them — an allowance the SDK could not READ is not an allowance
  // the user must GRANT.
  it('keeps a code the provider set, even when the message matches a pattern', async () => {
    const classified = new TransactionError(
      LiFiErrorCode.TransactionSimulationFailed,
      'Could not read the CDEF spending allowance for CABC'
    )

    const parsed = await parseStellarErrors(classified)

    expect((parsed.cause as TransactionError).code).toBe(
      LiFiErrorCode.TransactionSimulationFailed
    )
  })

  // callStellarRpcsWithRetry collapses every RPC rejection into an
  // AggregateError. Classifying its message alone would surface UnknownError.
  it('classifies from inside an AggregateError', async () => {
    const aggregate = new AggregateError(
      [new Error('User rejected the request')],
      'All 2 Stellar RPCs failed'
    )

    const parsed = await parseStellarErrors(aggregate)

    expect((parsed.cause as TransactionError).code).toBe(
      LiFiErrorCode.SignatureRejected
    )
  })

  it('prefers an already classified error inside an AggregateError', async () => {
    const classified = new TransactionError(
      LiFiErrorCode.TransactionSimulationFailed,
      'simulation failed'
    )
    const aggregate = new AggregateError(
      [new Error('connect ETIMEDOUT'), classified],
      'All 2 Stellar RPCs failed'
    )

    const parsed = await parseStellarErrors(aggregate)

    expect(parsed.cause).toBe(classified)
  })
```

- [ ] **Step 2: Run them to make sure they fail**

```bash
pnpm --filter @lifi/sdk-provider-stellar test parseStellarErrors
```

Expected: all three FAIL. The first returns `AllowanceRequired` (1014), the other two return `UnknownError`.

- [ ] **Step 3: Reorder the branches in `parseStellarErrors`**

In `packages/sdk-provider-stellar/src/errors/parseStellarErrors.ts`, replace the opening of `handleSpecificErrors`:

```ts
const handleSpecificErrors = (e: any) => {
  // Stellar Wallets Kit surfaces wallet rejections as messages rather than typed
  // errors, and the shape varies per wallet — match on the text, as Sui does.
  const message: string = typeof e === 'string' ? e : (e?.message ?? '')
```

with:

```ts
const handleSpecificErrors = (e: any): BaseError => {
  // `callStellarRpcsWithRetry` collapses every rejection into an AggregateError,
  // whose own message says nothing useful. Classify from the error it hides,
  // preferring one this package already classified.
  if (e instanceof AggregateError && e.errors.length) {
    const classified = e.errors.find(
      (error: unknown) => error instanceof BaseError
    )
    return handleSpecificErrors(classified ?? e.errors[0])
  }

  // A code this package set on purpose wins over message matching: an allowance
  // the SDK could not read is not an allowance the user has to grant.
  if (e instanceof BaseError) {
    return e
  }

  // Stellar Wallets Kit surfaces wallet rejections as messages rather than typed
  // errors, and the shape varies per wallet — match on the text, as Sui does.
  const message: string = typeof e === 'string' ? e : (e?.message ?? '')
```

Then delete the now-unreachable passthrough near the end of the function:

```ts
  if (e instanceof BaseError) {
    return e
  }

```

- [ ] **Step 4: Run the error tests to verify they pass**

```bash
pnpm --filter @lifi/sdk-provider-stellar test parseStellarErrors
```

Expected: the whole suite passes, old cases included.

- [ ] **Step 5: Write the failing `readAllowance` test**

Create `packages/sdk-provider-stellar/src/core/tasks/helpers/readAllowance.unit.spec.ts`.

Two details make this test earn its keep. First, `rpc.Api.isSimulationSuccess` is `'transactionData' in sim` and `isSimulationError` is `'error' in sim`, so plain object fixtures drive the real predicates. Second, the mocked `callStellarRpcsWithRetry` **reproduces the real failover semantics** — try each server, collect the rejections, collapse them into an `AggregateError`. A mock that simply called the callback once would let the current, broken code pass.

```ts
import { LiFiErrorCode, TransactionError } from '@lifi/sdk'
import { Keypair, nativeToScVal, StrKey } from '@stellar/stellar-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const simulateTransaction = vi.fn()

// Mirrors the real wrapper: every rejection the callback produces is collected
// and collapsed into an AggregateError. That is exactly what must NOT happen to
// a deliberately classified error, so the mock has to be faithful or this suite
// would pass against the bug.
vi.mock('../../../client/getStellarRpc.js', () => ({
  callStellarRpcsWithRetry: async (
    _client: unknown,
    fn: (server: unknown) => Promise<unknown>
  ) => {
    const servers = [{ simulateTransaction }, { simulateTransaction }]
    const errors: Error[] = []
    for (const server of servers) {
      try {
        return await fn(server)
      } catch (error) {
        errors.push(error as Error)
      }
    }
    throw new AggregateError(errors, `All ${servers.length} Stellar RPCs failed`)
  },
}))

const { readAllowance } = await import('./readAllowance.js')

const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 4))
const SPENDER = StrKey.encodeContract(Buffer.alloc(32, 7))
const FROM = Keypair.random().publicKey()
const PASSPHRASE = 'Test SDF Network ; September 2015'

const read = () => readAllowance({} as never, TOKEN, FROM, SPENDER, PASSPHRASE)

describe('readAllowance', () => {
  beforeEach(() => {
    simulateTransaction.mockReset()
  })

  it('decodes the simulated allowance', async () => {
    simulateTransaction.mockResolvedValue({
      transactionData: {},
      latestLedger: 42,
      result: { retval: nativeToScVal(1_000n, { type: 'i128' }) },
    })

    await expect(read()).resolves.toBe(1_000n)
  })

  // Degrading to 0n would read as "needs approval" and prompt the user for an
  // approval that cannot help — so the failure has to reach parseStellarErrors
  // with its code intact rather than buried in an AggregateError.
  it('throws a classified error the failover wrapper cannot swallow', async () => {
    simulateTransaction.mockResolvedValue({
      error: 'HostError: Error(Contract, #13)',
      latestLedger: 42,
    })

    const thrown = await read().catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(TransactionError)
    expect((thrown as TransactionError).code).toBe(
      LiFiErrorCode.TransactionSimulationFailed
    )
    expect((thrown as TransactionError).message).toContain(
      'HostError: Error(Contract, #13)'
    )
  })

  // A contract-level failure is deterministic. Asking every remaining RPC the
  // same question only delays the answer.
  it('does not retry a deterministic simulation failure across RPCs', async () => {
    simulateTransaction.mockResolvedValue({
      error: 'HostError: Error(Contract, #13)',
      latestLedger: 42,
    })

    await read().catch(() => undefined)

    expect(simulateTransaction).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 6: Run it to make sure it fails**

```bash
pnpm --filter @lifi/sdk-provider-stellar test readAllowance
```

Expected: the second and third tests FAIL. Today the throw happens inside the callback, so the wrapper retries the second server (`simulateTransaction` called twice) and then rejects with an `AggregateError`, not a `TransactionError`. The first test passes already.

- [ ] **Step 7: Move the classification outside the failover wrapper**

Replace the body of `packages/sdk-provider-stellar/src/core/tasks/helpers/readAllowance.ts` from `export const readAllowance` to the end of the file:

```ts
export const readAllowance = async (
  client: SDKClient,
  token: string,
  from: string,
  spender: string,
  networkPassphrase: string
): Promise<bigint> => {
  // A zero-sequence account is sufficient for read-only simulation, and one
  // built envelope is reusable across servers because nothing about it is
  // server-specific.
  const source = new Account(from, '0')
  const transaction = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      new Contract(token).call(
        'allowance',
        Address.fromString(from).toScVal(),
        Address.fromString(spender).toScVal()
      )
    )
    .setTimeout(30)
    .build()

  // Only the transport call goes through the failover wrapper. It collapses
  // everything its callback throws into an `AggregateError`, so classifying
  // inside it would hide the error below from `parseStellarErrors`.
  const simulation = await callStellarRpcsWithRetry(client, (server) =>
    server.simulateTransaction(transaction)
  )

  // Fail rather than degrade to 0n: an unreadable allowance treated as "needs
  // approval" would prompt the user for an approval that cannot help.
  if (!rpc.Api.isSimulationSuccess(simulation) || !simulation.result) {
    throw new TransactionError(
      LiFiErrorCode.TransactionSimulationFailed,
      `Could not read the ${token} spending allowance for ${spender}${
        rpc.Api.isSimulationError(simulation) ? `: ${simulation.error}` : ''
      }`
    )
  }
  const allowance = scValToNative(simulation.result.retval)
  return allowance != null ? BigInt(allowance) : 0n
}
```

Keep the imports as they are. Update the file's leading doc comment by replacing the sentence that begins `Classified here rather than left as a bare Error` — it described the opposite of what the code did — with:

```ts
/**
 * Reads the SAC `allowance(from, spender)` via read-only simulation.
 *
 * An absent or expired allowance entry reads back as `0`, so callers can treat
 * the result as a plain numeric comparison without a separate existence check.
 *
 * The simulation is the only part that goes through `callStellarRpcsWithRetry`;
 * the result is classified outside it, so a deterministic contract-level failure
 * is not retried against every RPC and is not buried in an `AggregateError`.
 */
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
pnpm --filter @lifi/sdk-provider-stellar test readAllowance parseStellarErrors
```

Expected: both suites pass.

- [ ] **Step 9: Run the gate and commit**

```bash
pnpm check:write && pnpm build && pnpm check:types && pnpm test
git checkout -- packages/sdk/src/version.ts \
  packages/sdk-provider-bitcoin/src/version.ts \
  packages/sdk-provider-ethereum/src/version.ts \
  packages/sdk-provider-solana/src/version.ts \
  packages/sdk-provider-sui/src/version.ts \
  packages/sdk-provider-tron/src/version.ts
git add packages/sdk-provider-stellar/src/errors/parseStellarErrors.ts \
  packages/sdk-provider-stellar/src/errors/parseStellarErrors.unit.spec.ts \
  packages/sdk-provider-stellar/src/core/tasks/helpers/readAllowance.ts \
  packages/sdk-provider-stellar/src/core/tasks/helpers/readAllowance.unit.spec.ts
git commit -m "fix(stellar): keep classified errors classified"
```

---

### Task 4: Make submission and confirmation survive transient failures (§8)

**Files:**
- Create: `packages/sdk-provider-stellar/src/core/tasks/helpers/probeStellarTransaction.ts`
- Create: `packages/sdk-provider-stellar/src/core/tasks/helpers/probeStellarTransaction.unit.spec.ts`
- Modify: `packages/sdk-provider-stellar/src/core/tasks/helpers/waitForStellarTransaction.ts` (replace the whole file)
- Create: `packages/sdk-provider-stellar/src/core/tasks/helpers/waitForStellarTransaction.unit.spec.ts`
- Modify: `packages/sdk-provider-stellar/src/core/tasks/helpers/submitStellarTransaction.ts`
- Create: `packages/sdk-provider-stellar/src/core/tasks/helpers/submitStellarTransaction.unit.spec.ts`
- Modify: `packages/sdk-provider-stellar/src/core/tasks/StellarWaitForTransactionTask.ts`
- Modify: `packages/sdk-provider-stellar/src/core/tasks/StellarWaitForTransactionTask.unit.spec.ts`

**Interfaces:**
- Consumes: `callStellarRpcsWithRetry`, `submitStellarTransaction`, `waitForStellarTransaction`
- Produces:
  - `type StellarTransactionProbe = 'landed' | 'not-found' | 'unknown'`
  - `probeStellarTransaction(client: SDKClient, transactionHash: string): Promise<StellarTransactionProbe>`
  - `waitForStellarTransaction` keeps its signature; its budget becomes a 330 s deadline

- [ ] **Step 1: Write the failing probe test**

Create `packages/sdk-provider-stellar/src/core/tasks/helpers/probeStellarTransaction.unit.spec.ts`:

```ts
import { rpc } from '@stellar/stellar-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getTransaction = vi.fn()

vi.mock('../../../client/getStellarRpc.js', () => ({
  callStellarRpcsWithRetry: async (
    _client: unknown,
    fn: (server: unknown) => Promise<unknown>
  ) => fn({ getTransaction }),
}))

const { probeStellarTransaction } = await import('./probeStellarTransaction.js')

describe('probeStellarTransaction', () => {
  beforeEach(() => {
    getTransaction.mockReset()
  })

  it('reports a transaction the network has applied', async () => {
    getTransaction.mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.SUCCESS,
    })

    await expect(probeStellarTransaction({} as never, 'h')).resolves.toBe(
      'landed'
    )
  })

  // A FAILED transaction still consumed the sequence number, so re-submitting
  // the same envelope can only fail.
  it('treats an applied failure as landed', async () => {
    getTransaction.mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.FAILED,
    })

    await expect(probeStellarTransaction({} as never, 'h')).resolves.toBe(
      'landed'
    )
  })

  it('reports NOT_FOUND distinctly from a failed probe', async () => {
    getTransaction.mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.NOT_FOUND,
    })

    await expect(probeStellarTransaction({} as never, 'h')).resolves.toBe(
      'not-found'
    )
  })

  // The caller must not trust a re-submit error after this: the transaction may
  // well have landed and the network simply could not tell us.
  it('reports unknown when every RPC rejects', async () => {
    getTransaction.mockRejectedValue(
      new AggregateError([new Error('boom')], 'All 2 Stellar RPCs failed')
    )

    await expect(probeStellarTransaction({} as never, 'h')).resolves.toBe(
      'unknown'
    )
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
pnpm --filter @lifi/sdk-provider-stellar test probeStellarTransaction
```

Expected: FAIL — `Cannot find module './probeStellarTransaction.js'`.

- [ ] **Step 3: Write the probe helper**

Create `packages/sdk-provider-stellar/src/core/tasks/helpers/probeStellarTransaction.ts`:

```ts
import type { SDKClient } from '@lifi/sdk'
import { rpc } from '@stellar/stellar-sdk'
import { callStellarRpcsWithRetry } from '../../../client/getStellarRpc.js'

/**
 * What the network could tell us about a hash.
 *
 * `'not-found'` and `'unknown'` both mean "re-submit", but only `'not-found'`
 * is a definite answer. A re-submit error after `'unknown'` may come from a
 * transaction that in fact settled, so the caller must not report it.
 */
export type StellarTransactionProbe = 'landed' | 'not-found' | 'unknown'

/**
 * Asks whether the network already knows a transaction, without waiting for it.
 *
 * Soroban RPC only knows a transaction once it has been applied, so `NOT_FOUND`
 * stays ambiguous — never broadcast, or broadcast and still pending.
 */
export const probeStellarTransaction = async (
  client: SDKClient,
  transactionHash: string
): Promise<StellarTransactionProbe> => {
  try {
    const response = await callStellarRpcsWithRetry(client, (server) =>
      server.getTransaction(transactionHash)
    )
    return response.status === rpc.Api.GetTransactionStatus.NOT_FOUND
      ? 'not-found'
      : 'landed'
  } catch {
    return 'unknown'
  }
}
```

- [ ] **Step 4: Run the probe test to verify it passes**

```bash
pnpm --filter @lifi/sdk-provider-stellar test probeStellarTransaction
```

Expected: 4 passed.

- [ ] **Step 5: Write the failing wait test**

Create `packages/sdk-provider-stellar/src/core/tasks/helpers/waitForStellarTransaction.unit.spec.ts`:

```ts
import { LiFiErrorCode, TransactionError } from '@lifi/sdk'
import { rpc } from '@stellar/stellar-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getTransaction = vi.fn()

vi.mock('../../../client/getStellarRpc.js', () => ({
  callStellarRpcsWithRetry: async (
    _client: unknown,
    fn: (server: unknown) => Promise<unknown>
  ) => fn({ getTransaction }),
}))

const { waitForStellarTransaction } = await import(
  './waitForStellarTransaction.js'
)

const POLL_MS = 3_000

describe('waitForStellarTransaction', () => {
  beforeEach(() => {
    getTransaction.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns as soon as the transaction is applied', async () => {
    const success = { status: rpc.Api.GetTransactionStatus.SUCCESS }
    getTransaction.mockResolvedValue(success)

    await expect(
      waitForStellarTransaction({} as never, 'h', POLL_MS)
    ).resolves.toBe(success)
  })

  it('reports an applied failure without waiting out the budget', async () => {
    getTransaction.mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.FAILED,
      resultXdr: undefined,
    })

    const thrown = await waitForStellarTransaction({} as never, 'h', POLL_MS)
      .then(() => undefined)
      .catch((error: unknown) => error)

    expect((thrown as TransactionError).code).toBe(
      LiFiErrorCode.TransactionFailed
    )
  })

  // One rate-limit burst across every configured RPC must cost an interval, not
  // the whole wait — the transaction is still perfectly healthy.
  it('survives a transport failure and keeps polling', async () => {
    getTransaction
      .mockRejectedValueOnce(
        new AggregateError([new Error('429')], 'All 2 Stellar RPCs failed')
      )
      .mockResolvedValue({ status: rpc.Api.GetTransactionStatus.SUCCESS })

    const promise = waitForStellarTransaction({} as never, 'h', POLL_MS)
    await vi.advanceTimersByTimeAsync(POLL_MS * 2)

    await expect(promise).resolves.toEqual({
      status: rpc.Api.GetTransactionStatus.SUCCESS,
    })
    expect(getTransaction).toHaveBeenCalledTimes(2)
  })

  // The envelope's timebounds are `now + 300 s`, so the budget has to outlive
  // them: giving up at 90 s reported a still-live transaction as dead.
  it('polls past the 300 s timebounds before giving up', async () => {
    getTransaction.mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.NOT_FOUND,
    })

    const promise = waitForStellarTransaction({} as never, 'h', POLL_MS)
    const thrown = promise.then(() => undefined).catch((error) => error)

    await vi.advanceTimersByTimeAsync(300_000)
    expect(getTransaction.mock.calls.length).toBeGreaterThan(95)

    await vi.advanceTimersByTimeAsync(35_000)
    expect(((await thrown) as TransactionError).code).toBe(
      LiFiErrorCode.Timeout
    )
  })

  it('carries the last transport error as the timeout cause', async () => {
    const transport = new AggregateError(
      [new Error('boom')],
      'All 2 Stellar RPCs failed'
    )
    getTransaction.mockRejectedValue(transport)

    const promise = waitForStellarTransaction({} as never, 'h', POLL_MS)
    const thrown = promise.then(() => undefined).catch((error) => error)
    await vi.advanceTimersByTimeAsync(335_000)

    expect(((await thrown) as TransactionError).cause).toBe(transport)
  })
})
```

- [ ] **Step 6: Run it to make sure it fails**

```bash
pnpm --filter @lifi/sdk-provider-stellar test waitForStellarTransaction
```

Expected: the transport-failure, past-300 s and timeout-cause tests FAIL. The current loop rethrows any transport error and stops after 30 attempts (90 s).

- [ ] **Step 7: Rewrite the wait helper**

Replace the entire contents of `packages/sdk-provider-stellar/src/core/tasks/helpers/waitForStellarTransaction.ts`:

```ts
import { LiFiErrorCode, type SDKClient, TransactionError } from '@lifi/sdk'
import { rpc } from '@stellar/stellar-sdk'
import { callStellarRpcsWithRetry } from '../../../client/getStellarRpc.js'

const CONFIRM_POLL_INTERVAL_MS = 3_000

/**
 * Outlives the backend's `[0, now + 300 s]` timebounds, so a transaction that
 * has not been applied by the deadline is genuinely dead rather than still in
 * flight. Expressed as a deadline, not an attempt count, so a caller-supplied
 * polling interval cannot shorten the budget.
 */
const CONFIRM_TIMEOUT_MS = 330_000

/**
 * Polls `getTransaction` until the transaction is included in a ledger.
 *
 * `NOT_FOUND` is not an error — Soroban RPC only knows a transaction once it has
 * been applied — so polling continues until the deadline passes and the result
 * is reported as a timeout rather than a failure.
 *
 * A transport failure costs one interval rather than the whole wait: every RPC
 * can reject one read during a rate-limit burst while the transaction is
 * perfectly healthy. The last such error rides along as the timeout's cause.
 */
export const waitForStellarTransaction = async (
  client: SDKClient,
  transactionHash: string,
  pollingIntervalMs: number = CONFIRM_POLL_INTERVAL_MS
): Promise<rpc.Api.GetSuccessfulTransactionResponse> => {
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS
  let lastTransportError: Error | undefined

  while (Date.now() < deadline) {
    try {
      const response = await callStellarRpcsWithRetry(client, (server) =>
        server.getTransaction(transactionHash)
      )

      if (response.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        return response
      }

      if (response.status === rpc.Api.GetTransactionStatus.FAILED) {
        throw new TransactionError(
          LiFiErrorCode.TransactionFailed,
          `Stellar transaction ${transactionHash} failed: ${
            response.resultXdr?.result().switch().name ?? 'unknown reason'
          }`
        )
      }
    } catch (error) {
      // The ledger's verdict is terminal; only transport failures are retried.
      if (error instanceof TransactionError) {
        throw error
      }
      lastTransportError =
        error instanceof Error ? error : new Error(String(error))
    }

    await new Promise((resolve) => setTimeout(resolve, pollingIntervalMs))
  }

  throw new TransactionError(
    LiFiErrorCode.Timeout,
    `Stellar transaction ${transactionHash} was not confirmed in time.`,
    lastTransportError
  )
}
```

- [ ] **Step 8: Run the wait test to verify it passes**

```bash
pnpm --filter @lifi/sdk-provider-stellar test waitForStellarTransaction
```

Expected: 5 passed.

- [ ] **Step 9: Write the failing submit test**

Create `packages/sdk-provider-stellar/src/core/tasks/helpers/submitStellarTransaction.unit.spec.ts`:

```ts
import { LiFiErrorCode, type TransactionError } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendTransaction = vi.fn()

vi.mock('../../../client/getStellarRpc.js', () => ({
  callStellarRpcsWithRetry: async (
    _client: unknown,
    fn: (server: unknown) => Promise<unknown>
  ) => fn({ sendTransaction }),
}))

// `fromXDR` is the only runtime member this module uses; everything else it
// imports from the SDK is a type and erases at build time.
vi.mock('@stellar/stellar-sdk', () => ({
  TransactionBuilder: { fromXDR: () => ({}) },
}))

const { submitStellarTransaction } = await import(
  './submitStellarTransaction.js'
)

const submit = () =>
  submitStellarTransaction({} as never, 'ENVELOPE_XDR', 'passphrase')

describe('submitStellarTransaction', () => {
  beforeEach(() => {
    sendTransaction.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the hash for PENDING and for DUPLICATE', async () => {
    sendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'h1' })
    await expect(submit()).resolves.toBe('h1')

    sendTransaction.mockResolvedValue({ status: 'DUPLICATE', hash: 'h2' })
    await expect(submit()).resolves.toBe('h2')
  })

  // TRY_AGAIN_LATER means "valid, not queued, send it again" — treating it as
  // terminal turned ledger congestion into a failed route.
  it('retries TRY_AGAIN_LATER and succeeds', async () => {
    sendTransaction
      .mockResolvedValueOnce({ status: 'TRY_AGAIN_LATER' })
      .mockResolvedValueOnce({ status: 'TRY_AGAIN_LATER' })
      .mockResolvedValueOnce({ status: 'PENDING', hash: 'h3' })

    const promise = submit()
    await vi.advanceTimersByTimeAsync(6_000)

    await expect(promise).resolves.toBe('h3')
    expect(sendTransaction).toHaveBeenCalledTimes(3)
  })

  it('gives up on TRY_AGAIN_LATER after the attempt budget', async () => {
    sendTransaction.mockResolvedValue({ status: 'TRY_AGAIN_LATER' })

    const promise = submit()
    const thrown = promise.then(() => undefined).catch((error) => error)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(((await thrown) as TransactionError).code).toBe(
      LiFiErrorCode.RateLimitExceeded
    )
    expect(sendTransaction).toHaveBeenCalledTimes(3)
  })

  it('throws immediately on a terminal status', async () => {
    sendTransaction.mockResolvedValue({ status: 'ERROR' })

    const thrown = await submit().catch((error: unknown) => error)

    expect(((thrown) as TransactionError).code).toBe(
      LiFiErrorCode.TransactionFailed
    )
    expect(sendTransaction).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 10: Run it to make sure it fails**

```bash
pnpm --filter @lifi/sdk-provider-stellar test submitStellarTransaction
```

Expected: the two retry tests FAIL — the current code throws `RateLimitExceeded` after a single `TRY_AGAIN_LATER`.

- [ ] **Step 11: Add the bounded retry**

In `packages/sdk-provider-stellar/src/core/tasks/helpers/submitStellarTransaction.ts`, add the constants above the exported function:

```ts
/**
 * `TRY_AGAIN_LATER` says the envelope is valid but was not queued, so the fix
 * is to send the same envelope again. Submission is idempotent by hash, which
 * makes the retry free of side effects.
 */
const TRY_AGAIN_ATTEMPTS = 3
const TRY_AGAIN_DELAY_MS = 2_000
```

Then replace the body from `const response` to the end of the function with:

```ts
  for (let attempt = 0; attempt < TRY_AGAIN_ATTEMPTS; attempt++) {
    const response: rpc.Api.SendTransactionResponse =
      await callStellarRpcsWithRetry(client, (server) =>
        server.sendTransaction(transaction)
      )

    switch (response.status) {
      case 'PENDING':
      case 'DUPLICATE':
        return response.hash
      case 'TRY_AGAIN_LATER':
        break
      default:
        throw new TransactionError(
          LiFiErrorCode.TransactionFailed,
          `Stellar transaction submission failed: ${
            response.errorResult?.result().switch().name ?? response.status
          }`
        )
    }

    if (attempt < TRY_AGAIN_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, TRY_AGAIN_DELAY_MS))
    }
  }

  throw new TransactionError(
    LiFiErrorCode.RateLimitExceeded,
    'Stellar RPC asked to try again later.'
  )
}
```

Add a sentence to the file's doc comment, after the `DUPLICATE` paragraph:

```
 * `TRY_AGAIN_LATER` is retried a bounded number of times rather than thrown:
 * core is telling us the envelope was not queued, not that it is invalid.
```

- [ ] **Step 12: Run the submit test to verify it passes**

```bash
pnpm --filter @lifi/sdk-provider-stellar test submitStellarTransaction
```

Expected: 4 passed.

- [ ] **Step 13: Update the resume test to demand a probe**

In `packages/sdk-provider-stellar/src/core/tasks/StellarWaitForTransactionTask.unit.spec.ts`, add the probe mock beside the existing two, above the dynamic import:

```ts
const probeStellarTransaction = vi.fn()
vi.mock('./helpers/probeStellarTransaction.js', () => ({
  probeStellarTransaction: (...args: unknown[]) =>
    probeStellarTransaction(...args),
}))
```

Extend `beforeEach`:

```ts
    probeStellarTransaction.mockReset().mockResolvedValue('not-found')
```

Replace the test named `re-submits the persisted envelope on resume before polling` with these five:

```ts
  // The hash is persisted BEFORE submission, so on resume the envelope may never
  // have reached the network.
  it('re-submits on resume when the network does not know the hash', async () => {
    const order: string[] = []
    submitStellarTransaction.mockImplementation(async () => {
      order.push('submit')
      return 'hash'
    })
    waitForStellarTransaction.mockImplementation(async () => {
      order.push('wait')
    })
    const { context } = makeContext({
      type: 'SWAP',
      txHash: 'persisted-hash',
      txHex: 'PERSISTED_XDR',
    })

    await new StellarWaitForTransactionTask().run(context)

    expect(order).toEqual(['submit', 'wait'])
    expect(submitStellarTransaction).toHaveBeenCalledWith(
      {},
      'PERSISTED_XDR',
      Networks.TESTNET
    )
  })

  // Re-submitting an applied envelope can only fail: its sequence number is
  // spent. That failure used to mark a settled swap FAILED.
  it('does not re-submit a transaction the network has already applied', async () => {
    probeStellarTransaction.mockResolvedValue('landed')
    const { context } = makeContext({
      type: 'SWAP',
      txHash: 'persisted-hash',
      txHex: 'PERSISTED_XDR',
    })

    await new StellarWaitForTransactionTask().run(context)

    expect(submitStellarTransaction).not.toHaveBeenCalled()
    expect(waitForStellarTransaction).toHaveBeenCalledWith(
      {},
      'persisted-hash',
      undefined
    )
  })

  it('polls anyway when the re-submit fails', async () => {
    submitStellarTransaction.mockRejectedValue(new Error('txBadSeq'))
    const { context } = makeContext({
      type: 'SWAP',
      txHash: 'persisted-hash',
      txHex: 'PERSISTED_XDR',
    })

    await expect(
      new StellarWaitForTransactionTask().run(context)
    ).resolves.toEqual({ status: 'COMPLETED' })
    expect(waitForStellarTransaction).toHaveBeenCalled()
  })

  it('reports the re-submit failure when a definite probe is followed by a timeout', async () => {
    const submitError = new Error('txTooLate')
    submitStellarTransaction.mockRejectedValue(submitError)
    waitForStellarTransaction.mockRejectedValue(
      new TransactionError(LiFiErrorCode.Timeout, 'not confirmed in time')
    )
    const { context } = makeContext({
      type: 'SWAP',
      txHash: 'persisted-hash',
      txHex: 'PERSISTED_XDR',
    })

    await expect(
      new StellarWaitForTransactionTask().run(context)
    ).rejects.toBe(submitError)
  })

  // After a failed probe the re-submit error may be a txBAD_SEQ from a swap that
  // in fact settled. Reporting it would be worse than the timeout.
  it('keeps the timeout when the probe itself failed', async () => {
    probeStellarTransaction.mockResolvedValue('unknown')
    submitStellarTransaction.mockRejectedValue(new Error('txBadSeq'))
    const timeout = new TransactionError(
      LiFiErrorCode.Timeout,
      'not confirmed in time'
    )
    waitForStellarTransaction.mockRejectedValue(timeout)
    const { context } = makeContext({
      type: 'SWAP',
      txHash: 'persisted-hash',
      txHex: 'PERSISTED_XDR',
    })

    await expect(
      new StellarWaitForTransactionTask().run(context)
    ).rejects.toBe(timeout)
  })
```

Add the import the new tests need, at the top of the file:

```ts
import { LiFiErrorCode, TransactionError } from '@lifi/sdk'
```

- [ ] **Step 14: Run it to make sure it fails**

```bash
pnpm --filter @lifi/sdk-provider-stellar test StellarWaitForTransactionTask
```

Expected: the four new tests FAIL. The task re-submits unconditionally and lets the submit error escape.

- [ ] **Step 15: Rewrite the resume branch of the task**

In `packages/sdk-provider-stellar/src/core/tasks/StellarWaitForTransactionTask.ts`, add the import:

```ts
import { probeStellarTransaction } from './helpers/probeStellarTransaction.js'
```

Replace the resume block and the wait call — everything from the `// Resuming:` comment down to the `await waitForStellarTransaction(...)` line — with:

```ts
    // Resuming: the hash is persisted before submission, so the envelope may
    // never have reached the network — but it may equally have been applied
    // already, in which case its sequence number is spent and re-submitting can
    // only fail. Ask the network first, and let the poll below decide the
    // outcome either way.
    let resubmitError: unknown
    if (!transactionHash && action.txHex) {
      const probe = await probeStellarTransaction(client, hash)
      if (probe !== 'landed') {
        try {
          await submitStellarTransaction(client, action.txHex, networkPassphrase)
        } catch (error) {
          // Keep it only when the probe was definite. After a failed probe this
          // may be a txBAD_SEQ from a swap that in fact settled.
          resubmitError = probe === 'not-found' ? error : undefined
        }
      }
    }

    try {
      await waitForStellarTransaction(client, hash, pollingIntervalMs)
    } catch (error) {
      // The envelope never reached the network, and the poll can only report
      // that as a timeout. The submission error says why.
      if (
        resubmitError &&
        error instanceof BaseError &&
        error.code === LiFiErrorCode.Timeout
      ) {
        throw resubmitError
      }
      throw error
    }
```

Add `BaseError` to the existing `@lifi/sdk` import at the top of the file.

- [ ] **Step 16: Run the task test to verify it passes**

```bash
pnpm --filter @lifi/sdk-provider-stellar test StellarWaitForTransactionTask
```

Expected: 8 passed.

- [ ] **Step 17: Run the gate and commit**

```bash
pnpm check:write && pnpm build && pnpm check:types && pnpm test
git checkout -- packages/sdk/src/version.ts \
  packages/sdk-provider-bitcoin/src/version.ts \
  packages/sdk-provider-ethereum/src/version.ts \
  packages/sdk-provider-solana/src/version.ts \
  packages/sdk-provider-sui/src/version.ts \
  packages/sdk-provider-tron/src/version.ts
git add packages/sdk-provider-stellar/src/core/tasks/helpers/probeStellarTransaction.ts \
  packages/sdk-provider-stellar/src/core/tasks/helpers/probeStellarTransaction.unit.spec.ts \
  packages/sdk-provider-stellar/src/core/tasks/helpers/waitForStellarTransaction.ts \
  packages/sdk-provider-stellar/src/core/tasks/helpers/waitForStellarTransaction.unit.spec.ts \
  packages/sdk-provider-stellar/src/core/tasks/helpers/submitStellarTransaction.ts \
  packages/sdk-provider-stellar/src/core/tasks/helpers/submitStellarTransaction.unit.spec.ts \
  packages/sdk-provider-stellar/src/core/tasks/StellarWaitForTransactionTask.ts \
  packages/sdk-provider-stellar/src/core/tasks/StellarWaitForTransactionTask.unit.spec.ts
git commit -m "fix(stellar): make submission and confirmation survive transient failures"
```

---

### Task 5: Resolve and re-check the approval a route really needs (§9)

**Files:**
- Modify: `packages/sdk-provider-stellar/src/core/tasks/helpers/resolveApprovalRequirement.ts`
- Modify: `packages/sdk-provider-stellar/src/core/tasks/helpers/resolveApprovalRequirement.unit.spec.ts` (add one case)
- Create: `packages/sdk-provider-stellar/src/core/tasks/helpers/assertApprovalStillCovers.ts`
- Create: `packages/sdk-provider-stellar/src/core/tasks/helpers/assertApprovalStillCovers.unit.spec.ts`
- Modify: `packages/sdk-provider-stellar/src/core/tasks/StellarPrepareTransactionTask.ts` (add the `run()` override)
- Modify: `packages/sdk-provider-stellar/src/core/tasks/StellarPrepareTransactionTask.unit.spec.ts` (add one case)
- Modify: `packages/sdk-provider-stellar/src/actions/getStellarBalance.ts`
- Create: `packages/sdk-provider-stellar/src/actions/getStellarBalance.unit.spec.ts`

**Interfaces:**
- Consumes: `resolveApprovalRequirement(step)`, `readAllowance(client, token, from, spender, networkPassphrase)`, `StellarStepExecutorContext.approval` / `.wallet` / `.networkPassphrase`
- Produces: `assertApprovalStillCovers(context: StellarStepExecutorContext): Promise<void>`
- **State of `StellarPrepareTransactionTask.ts` when this task starts:** Task 2 already reduced it to a subclass of `PrepareTransactionTask` holding one method, `shouldRefetchTransaction`, under a long doc comment. It is not the 40-line copy of the base task that `main` and the PR head still show. Step 11 adds a second method to that small class.

- [ ] **Step 1: Write the failing predicate test**

Add to `packages/sdk-provider-stellar/src/core/tasks/helpers/resolveApprovalRequirement.unit.spec.ts`, inside the existing `describe`, after the `rejects a leg whose spender is not a Soroban contract` test:

```ts
  // The first leg needing an approval may name a placeholder spender. Bailing
  // out there left the CCTP leg that actually pulls funds with no allowance,
  // and the invocation reverted after the user had signed.
  it('skips a non-contract spender and keeps looking', () => {
    const placeholderLeg = leg(XLM_EURC, '1000', EVM_DIAMOND, false)

    expect(
      resolveApprovalRequirement(stepWith([placeholderLeg, cctpLeg]))
    ).toEqual({
      spender: CIRCLE_ADAPTER,
      tokenAddress: XLM_USDC,
      amount: 1089n,
    })
  })
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
pnpm --filter @lifi/sdk-provider-stellar test resolveApprovalRequirement
```

Expected: FAIL — the result is `undefined`, because `find` stops at the placeholder leg and the contract check then abandons the step.

- [ ] **Step 3: Merge the two conditions into one predicate**

In `packages/sdk-provider-stellar/src/core/tasks/helpers/resolveApprovalRequirement.ts`, replace the block from `const includedStep = step.includedSteps?.find(` down to and including the `if (!spender || !StrKey.isValidContract(spender))` guard with:

```ts
  // The pipeline grants at most one allowance per step, so the first leg that
  // needs one wins. A spender also has to be a real Soroban contract (`C`)
  // address: anything else — a `G` wallet, an EVM address — cannot call
  // `transfer_from`, so it is a placeholder rather than a reason to stop
  // looking. Routes today ask for a single approval; a route whose legs pull
  // two different tokens would need the executor to loop instead.
  const includedStep = step.includedSteps?.find(
    (includedStep) =>
      !includedStep.estimate.skipApproval &&
      !!includedStep.estimate.approvalAddress &&
      StrKey.isValidContract(includedStep.estimate.approvalAddress)
  )
  if (!includedStep) {
    return undefined
  }

  const spender = includedStep.estimate.approvalAddress as string
```

- [ ] **Step 4: Run the predicate test to verify it passes**

```bash
pnpm --filter @lifi/sdk-provider-stellar test resolveApprovalRequirement
```

Expected: 8 passed — the new case plus the seven that already existed.

- [ ] **Step 5: Write the failing re-check test**

Create `packages/sdk-provider-stellar/src/core/tasks/helpers/assertApprovalStillCovers.unit.spec.ts`:

```ts
import { LiFiErrorCode, type TransactionError } from '@lifi/sdk'
import { Keypair, StrKey } from '@stellar/stellar-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const readAllowance = vi.fn()
vi.mock('./readAllowance.js', () => ({
  readAllowance: (...args: unknown[]) => readAllowance(...args),
}))

const { assertApprovalStillCovers } = await import(
  './assertApprovalStillCovers.js'
)

const CIRCLE_ADAPTER = StrKey.encodeContract(Buffer.alloc(32, 7))
const OTHER_ADAPTER = StrKey.encodeContract(Buffer.alloc(32, 9))
const XLM_USDC = StrKey.encodeContract(Buffer.alloc(32, 4))
const WALLET = Keypair.random().publicKey()

const granted = {
  spender: CIRCLE_ADAPTER,
  tokenAddress: XLM_USDC,
  amount: 1_089n,
}

const contextWith = (
  spender: string,
  fromAmount: string,
  approval: object | undefined = granted
) =>
  ({
    client: {},
    wallet: { address: WALLET },
    networkPassphrase: 'Test SDF Network ; September 2015',
    approval,
    step: {
      action: { fromToken: { address: XLM_USDC }, fromAmount },
      estimate: { approvalAddress: spender },
      includedSteps: [
        {
          action: { fromToken: { address: XLM_USDC } },
          estimate: { fromAmount, approvalAddress: spender, skipApproval: false },
        },
      ],
    },
  }) as never

describe('assertApprovalStillCovers', () => {
  beforeEach(() => {
    readAllowance.mockReset().mockResolvedValue(1_089n)
  })

  it('passes when the granted allowance still covers the refreshed route', async () => {
    await expect(
      assertApprovalStillCovers(contextWith(CIRCLE_ADAPTER, '990'))
    ).resolves.toBeUndefined()
  })

  // A re-quote can name a different adapter. The allowance was written for the
  // old one, so the new one reads 0 and `transfer_from` would revert on-chain
  // after a second signature.
  it('throws when the refreshed route names a different spender', async () => {
    readAllowance.mockResolvedValue(0n)

    const thrown = await assertApprovalStillCovers(
      contextWith(OTHER_ADAPTER, '990')
    ).catch((error: unknown) => error)

    expect((thrown as TransactionError).code).toBe(
      LiFiErrorCode.TransactionUnprepared
    )
  })

  it('throws when the refreshed amount exceeds the allowance', async () => {
    readAllowance.mockResolvedValue(1_089n)

    const thrown = await assertApprovalStillCovers(
      contextWith(CIRCLE_ADAPTER, '5000')
    ).catch((error: unknown) => error)

    expect((thrown as TransactionError).code).toBe(
      LiFiErrorCode.TransactionUnprepared
    )
  })

  // The getRoutes path grants nothing before the refresh, so there is no grant
  // to invalidate and no reason to pay for a read.
  it('reads nothing when no approval was resolved before the refresh', async () => {
    await expect(
      assertApprovalStillCovers(contextWith(CIRCLE_ADAPTER, '990', undefined))
    ).resolves.toBeUndefined()
    expect(readAllowance).not.toHaveBeenCalled()
  })

  it('reads nothing when the refreshed route needs no approval', async () => {
    const context = contextWith(CIRCLE_ADAPTER, '990')
    ;(context as unknown as { step: { includedSteps: unknown[] } }).step.includedSteps = []

    await expect(assertApprovalStillCovers(context)).resolves.toBeUndefined()
    expect(readAllowance).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 6: Run it to make sure it fails**

```bash
pnpm --filter @lifi/sdk-provider-stellar test assertApprovalStillCovers
```

Expected: FAIL — `Cannot find module './assertApprovalStillCovers.js'`.

- [ ] **Step 7: Write the helper**

Create `packages/sdk-provider-stellar/src/core/tasks/helpers/assertApprovalStillCovers.ts`:

```ts
import { LiFiErrorCode, TransactionError } from '@lifi/sdk'
import type { StellarStepExecutorContext } from '../../../types.js'
import { readAllowance } from './readAllowance.js'
import { resolveApprovalRequirement } from './resolveApprovalRequirement.js'

/**
 * Fails the step before signing when the refreshed route needs an allowance the
 * sender does not have.
 *
 * `StellarPrepareTransactionTask` re-quotes after `StellarSetAllowanceTask` has
 * already written an allowance, and the re-quote replaces `includedSteps` and
 * `estimate` wholesale. A fresh quote that names a different adapter, a
 * different intermediate token, or a larger amount would revert `transfer_from`
 * on-chain after a second signature.
 *
 * The check reads the chain rather than comparing against the resolved
 * requirement: when the allowance already existed, the on-chain ceiling can be
 * far above what this route asked for, and comparing the two would reject a
 * route that works.
 */
export const assertApprovalStillCovers = async (
  context: StellarStepExecutorContext
): Promise<void> => {
  // Nothing was resolved before the refresh, so there is no grant to invalidate.
  if (!context.approval) {
    return
  }

  const refreshed = resolveApprovalRequirement(context.step)
  if (!refreshed) {
    return
  }

  const allowance = await readAllowance(
    context.client,
    refreshed.tokenAddress,
    context.wallet.address,
    refreshed.spender,
    context.networkPassphrase
  )

  if (allowance < refreshed.amount) {
    throw new TransactionError(
      LiFiErrorCode.TransactionUnprepared,
      'The refreshed Stellar route needs a token allowance the sender has not granted. Please request a new route.'
    )
  }
}
```

- [ ] **Step 8: Run the helper test to verify it passes**

```bash
pnpm --filter @lifi/sdk-provider-stellar test assertApprovalStillCovers
```

Expected: 5 passed.

- [ ] **Step 9: Write the failing wiring test**

Add to `packages/sdk-provider-stellar/src/core/tasks/StellarPrepareTransactionTask.unit.spec.ts`. Add the helper mock beside the existing `@lifi/sdk` mock, above the dynamic import:

```ts
const assertApprovalStillCovers = vi.fn(async () => undefined)
vi.mock('./helpers/assertApprovalStillCovers.js', () => ({
  assertApprovalStillCovers: (...args: unknown[]) =>
    assertApprovalStillCovers(...args),
}))
```

Extend `beforeEach` with `assertApprovalStillCovers.mockClear()`, then add:

```ts
  // The refresh happens inside the base task, so the granted allowance can only
  // be re-validated after it returns — and before the signing task runs.
  it('re-checks the granted allowance after the base task refreshes', async () => {
    const order: string[] = []
    baseRun.mockImplementation(async () => {
      order.push('refresh')
      return { status: 'COMPLETED' }
    })
    assertApprovalStillCovers.mockImplementation(async () => {
      order.push('assert')
    })
    const context = { step: {} } as never

    await new StellarPrepareTransactionTask().run(context)

    expect(order).toEqual(['refresh', 'assert'])
    expect(assertApprovalStillCovers).toHaveBeenCalledWith(context)
  })
```

- [ ] **Step 10: Run it to make sure it fails**

```bash
pnpm --filter @lifi/sdk-provider-stellar test StellarPrepareTransactionTask
```

Expected: FAIL — `assertApprovalStillCovers` was never called, because the class has no `run()` override yet.

- [ ] **Step 11: Add the `run()` override**

In `packages/sdk-provider-stellar/src/core/tasks/StellarPrepareTransactionTask.ts`, extend the imports and the class body:

```ts
import { PrepareTransactionTask, type TaskResult } from '@lifi/sdk'
import type { StellarStepExecutorContext } from '../../types.js'
import { assertApprovalStillCovers } from './helpers/assertApprovalStillCovers.js'
```

```ts
export class StellarPrepareTransactionTask extends PrepareTransactionTask {
  protected override shouldRefetchTransaction(): boolean {
    return true
  }

  override async run(
    context: StellarStepExecutorContext
  ): Promise<TaskResult> {
    const result = await super.run(context)
    // The refresh above may have re-quoted the route around a different
    // adapter or amount than the allowance was granted for.
    await assertApprovalStillCovers(context)
    return result
  }
}
```

Keep the existing doc comment on the class and add one line to it, after the numbered list:

```
 * Re-quoting also invalidates the allowance the pipeline just granted, so the
 * refreshed route is re-checked against the chain before the step is signed.
```

- [ ] **Step 12: Run the task test to verify it passes**

```bash
pnpm --filter @lifi/sdk-provider-stellar test StellarPrepareTransactionTask
```

Expected: 3 passed.

- [ ] **Step 13: Write the failing balance test**

Create `packages/sdk-provider-stellar/src/actions/getStellarBalance.unit.spec.ts`:

```ts
import type { Token } from '@lifi/sdk'
import { Keypair, nativeToScVal, StrKey } from '@stellar/stellar-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const simulateTransaction = vi.fn()

vi.mock('../client/getStellarRpc.js', () => ({
  callStellarRpcsWithRetry: async (
    _client: unknown,
    fn: (server: unknown) => Promise<unknown>
  ) => fn({ simulateTransaction }),
}))

const { getStellarBalance } = await import('./getStellarBalance.js')

const WALLET = Keypair.random().publicKey()
const PASSPHRASE = 'Test SDF Network ; September 2015'

const token = (fill: number): Token =>
  ({
    address: StrKey.encodeContract(Buffer.alloc(32, fill)),
    chainId: 1500,
    decimals: 7,
    symbol: 'TKN',
  }) as Token

const balanceOf = (amount: bigint) => ({
  transactionData: {},
  latestLedger: 99,
  result: { retval: nativeToScVal(amount, { type: 'i128' }) },
})

describe('getStellarBalance', () => {
  beforeEach(() => {
    simulateTransaction.mockReset()
  })

  it('returns amounts and the ledger each read ran against', async () => {
    simulateTransaction.mockResolvedValue(balanceOf(500n))

    const [balance] = await getStellarBalance(
      {} as never,
      WALLET,
      [token(4)],
      PASSPHRASE
    )

    expect(balance.amount).toBe(500n)
    expect(balance.blockNumber).toBe(99n)
  })

  // Consumers read a missing blockNumber as an unsettled balance and poll
  // forever, so a wholly failed batch has to surface as a failure.
  it('throws when every read fails', async () => {
    simulateTransaction.mockRejectedValue(
      new Error('RPC URL not found for chainId: 1500')
    )

    await expect(
      getStellarBalance({} as never, WALLET, [token(4), token(5)], PASSPHRASE)
    ).rejects.toThrow(/RPC URL not found/)
  })

  it('lets a failed read borrow the batch ledger when another read succeeded', async () => {
    simulateTransaction
      .mockRejectedValueOnce(new Error('contract not found'))
      .mockResolvedValue(balanceOf(700n))

    const [failed, ok] = await getStellarBalance(
      {} as never,
      WALLET,
      [token(4), token(5)],
      PASSPHRASE
    )

    expect(failed.amount).toBeUndefined()
    expect(failed.blockNumber).toBe(99n)
    expect(ok.amount).toBe(700n)
  })
})
```

- [ ] **Step 14: Run it to make sure it fails**

```bash
pnpm --filter @lifi/sdk-provider-stellar test getStellarBalance.unit
```

Expected: the `throws when every read fails` test FAILS — the function currently resolves with amount-less tokens.

- [ ] **Step 15: Keep the read errors**

In `packages/sdk-provider-stellar/src/actions/getStellarBalance.ts`, replace the `const results = await Promise.all(...)` block and add the guard beneath it:

```ts
  const results = await Promise.all(
    tokens.map((token) =>
      withDedupe(
        () => getSacBalance(client, walletAddress, token, networkPassphrase),
        { id: `${getStellarBalance.name}.${walletAddress}.${token.address}` }
      ).then(
        (value) => ({ value, error: undefined as Error | undefined }),
        (error) => ({
          value: undefined,
          error: error instanceof Error ? error : new Error(String(error)),
        })
      )
    )
  )

  // Every read failed — the RPC list is unreachable, or the chain is not served
  // at all. Returning tokens with neither an amount nor a blockNumber reads to
  // consumers as a balance that has yet to settle, so they would poll forever
  // instead of seeing the failure.
  const firstError = results.find((result) => result.error)?.error
  if (firstError && results.every((result) => !result.value)) {
    throw firstError
  }
```

Then update the two places that consume `results`, replacing `result` with `result.value`:

```ts
  const fallbackBlockNumber = results.reduce<bigint | undefined>(
    (latest, result) =>
      result.value && (latest === undefined || result.value.latestLedger > latest)
        ? result.value.latestLedger
        : latest,
    undefined
  )

  return tokens.map((token, index) => {
    const result = results[index].value
    const blockNumber = result?.latestLedger ?? fallbackBlockNumber
    return result?.amount !== undefined
      ? { ...token, amount: result.amount, blockNumber }
      : { ...token, blockNumber }
  })
```

- [ ] **Step 16: Run the balance test to verify it passes**

```bash
pnpm --filter @lifi/sdk-provider-stellar test getStellarBalance.unit
```

Expected: 3 passed.

- [ ] **Step 17: Run the gate and commit**

```bash
pnpm check:write && pnpm build && pnpm check:types && pnpm test
git checkout -- packages/sdk/src/version.ts \
  packages/sdk-provider-bitcoin/src/version.ts \
  packages/sdk-provider-ethereum/src/version.ts \
  packages/sdk-provider-solana/src/version.ts \
  packages/sdk-provider-sui/src/version.ts \
  packages/sdk-provider-tron/src/version.ts
git add packages/sdk-provider-stellar/src/core/tasks/helpers/resolveApprovalRequirement.ts \
  packages/sdk-provider-stellar/src/core/tasks/helpers/resolveApprovalRequirement.unit.spec.ts \
  packages/sdk-provider-stellar/src/core/tasks/helpers/assertApprovalStillCovers.ts \
  packages/sdk-provider-stellar/src/core/tasks/helpers/assertApprovalStillCovers.unit.spec.ts \
  packages/sdk-provider-stellar/src/core/tasks/StellarPrepareTransactionTask.ts \
  packages/sdk-provider-stellar/src/core/tasks/StellarPrepareTransactionTask.unit.spec.ts \
  packages/sdk-provider-stellar/src/actions/getStellarBalance.ts \
  packages/sdk-provider-stellar/src/actions/getStellarBalance.unit.spec.ts
git commit -m "fix(stellar): resolve and re-check the approval a route really needs"
```

---

### Task 6: Finalise the public surface and the import surface (§10)

**Files:**
- Modify: `packages/sdk-provider-stellar/src/types.ts`
- Modify: `packages/sdk-provider-stellar/src/actions/resolveStellarAddress.ts` (replace the whole file)
- Create: `packages/sdk-provider-stellar/src/actions/resolveStellarAddress.unit.spec.ts`
- Modify: `packages/sdk-provider-stellar/src/StellarProvider.ts`
- Modify: `packages/sdk-provider-stellar/src/core/StellarStepExecutor.ts`
- Modify: `packages/sdk-provider-stellar/src/core/StellarStepExecutor.unit.spec.ts`
- Modify: `packages/sdk-provider-stellar/src/index.ts`
- Modify: `packages/sdk-provider-stellar/src/client/getStellarRpc.ts`, `.../helpers/submitStellarTransaction.ts`, `.../helpers/waitForStellarTransaction.ts`, `.../helpers/probeStellarTransaction.ts`, `.../helpers/readAllowance.ts`, `src/actions/getStellarBalance.ts` — RPC imports

**Interfaces:**
- Consumes: everything from Tasks 2–5
- Produces: `DEFAULT_NETWORK_PASSPHRASE: string` exported from `StellarProvider.ts` and re-exported by `src/index.ts`

- [ ] **Step 0: Capture the bundle baseline before touching anything**

Do this first. Once the edits below land there is no cheap way back to the "before" number.

`--splitting --outdir` is required, not optional. Without it esbuild inlines a dynamic `import()` of an already-reachable module straight back into the single output file, and the before/after numbers would match no matter what Step 5 does. The number that matters is the **entry chunk**, which is what a consumer loads first.

```bash
mkdir -p /tmp/stellar-bundle
printf "export * from '@lifi/sdk-provider-stellar'\n" > /tmp/stellar-bundle/entry.js
pnpm --filter @lifi/sdk-provider-stellar build
npx esbuild /tmp/stellar-bundle/entry.js --bundle --format=esm --minify \
  --splitting --outdir=/tmp/stellar-bundle/before
wc -c /tmp/stellar-bundle/before/entry.js
```

Write the entry-chunk byte count down. Step 13 produces the matching "after" number.

- [ ] **Step 1: Remove the dead options**

In `packages/sdk-provider-stellar/src/types.ts`:

- Delete the whole `horizonUrl` member from `StellarProviderOptions`, including its TSDoc block. Nothing reads it, and the fallback it documents does not exist.
- Make `signAuthEntry` optional in `StellarWallet` — change `signAuthEntry: (` to `signAuthEntry?: (`.
- Extend the `networkPassphrase` TSDoc in `StellarProviderOptions` so the balance limit is written down:

```ts
  /**
   * Network passphrase for the Stellar network this provider targets.
   * Defaults to the public (mainnet) network.
   *
   * Balance reads follow this option alone. Signing prefers it and falls back
   * to the connected wallet's passphrase, and `StellarStepExecutor.checkWallet`
   * refuses to sign when the two disagree — so a wallet on a different network
   * fails before the user signs, while balances still read against the option.
   */
  networkPassphrase?: string
```

- Extend the `StellarWallet.signAuthEntry` TSDoc:

```ts
  /**
   * Optional: the router routes use source-account auth, so the SDK never calls
   * this. Present so an adapter can forward the Stellar Wallets Kit method.
   */
```

- [ ] **Step 2: Prove `signAuthEntry` is optional**

In `packages/sdk-provider-stellar/src/core/StellarStepExecutor.unit.spec.ts`, delete this line from `makeExecutor`:

```ts
      signAuthEntry: async () => ({ signedAuthEntry: '' }),
```

`pnpm check:types` in Step 12 is what proves the member is optional — the file would not compile otherwise.

- [ ] **Step 3: Write the failing federation test**

Create `packages/sdk-provider-stellar/src/actions/resolveStellarAddress.unit.spec.ts`:

```ts
import { Keypair } from '@stellar/stellar-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolve = vi.fn()

vi.mock('@stellar/stellar-sdk', async () => {
  const actual =
    await vi.importActual<typeof import('@stellar/stellar-sdk')>(
      '@stellar/stellar-sdk'
    )
  return {
    ...actual,
    Federation: { Server: { resolve: (...args: unknown[]) => resolve(...args) } },
  }
})

const { resolveStellarAddress } = await import('./resolveStellarAddress.js')

const ACCOUNT = Keypair.random().publicKey()

describe('resolveStellarAddress', () => {
  beforeEach(() => {
    resolve.mockReset()
  })

  it('returns a G-address unchanged and never calls federation', async () => {
    await expect(resolveStellarAddress(ACCOUNT)).resolves.toBe(ACCOUNT)
    expect(resolve).not.toHaveBeenCalled()
  })

  it('ignores anything that is not a federation address', async () => {
    await expect(resolveStellarAddress('not-an-address')).resolves.toBeUndefined()
    expect(resolve).not.toHaveBeenCalled()
  })

  it('resolves a federation address with no memo', async () => {
    resolve.mockResolvedValue({ account_id: ACCOUNT })

    await expect(resolveStellarAddress('alice*lifi.io')).resolves.toBe(ACCOUNT)
  })

  // A memo is part of the destination for a custodial account. Neither the SDK
  // nor the route request can carry one, so resolving to the bare pooled
  // address would deliver funds no exchange could attribute.
  it('refuses to resolve when the record requires a memo', async () => {
    resolve.mockResolvedValue({
      account_id: ACCOUNT,
      memo: '123456',
      memo_type: 'id',
    })

    await expect(
      resolveStellarAddress('alice*exchange.com')
    ).resolves.toBeUndefined()
  })

  // The record comes from an arbitrary remote server; a muxed M-address would
  // otherwise slip past the G-address-only rule the provider enforces.
  it('rejects an account_id that is not a G-address', async () => {
    resolve.mockResolvedValue({ account_id: 'MABCDEF' })

    await expect(
      resolveStellarAddress('alice*lifi.io')
    ).resolves.toBeUndefined()
  })

  it('returns undefined when the federation server fails', async () => {
    resolve.mockRejectedValue(new Error('502'))

    await expect(
      resolveStellarAddress('alice*lifi.io')
    ).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 4: Run it to make sure it fails**

```bash
pnpm --filter @lifi/sdk-provider-stellar test resolveStellarAddress
```

Expected: the memo test and the M-address test FAIL — both currently resolve to `ACCOUNT` / `'MABCDEF'`.

- [ ] **Step 5: Rewrite the resolver**

Replace the entire contents of `packages/sdk-provider-stellar/src/actions/resolveStellarAddress.ts`:

```ts
import { StrKey } from '@stellar/stellar-sdk'

/**
 * Resolves a Stellar Federation address (SEP-2, `name*domain.com`) to a G-address.
 * Returns the input unchanged when it is already a valid G-address, and
 * `undefined` when it is neither a federation address nor safely resolvable.
 */
export async function resolveStellarAddress(
  name: string
): Promise<string | undefined> {
  if (StrKey.isValidEd25519PublicKey(name)) {
    return name
  }
  if (!name.includes('*')) {
    return undefined
  }
  try {
    // Loaded on demand. Federation pulls the StellarToml resolver and its TOML
    // parser in with it, and no other path in this package needs them — a
    // static import would put the whole chain in every consumer's bundle.
    const { Federation } = await import('@stellar/stellar-sdk')
    const record = await Federation.Server.resolve(name)
    // A memo is part of the destination for a custodial account, and neither
    // the SDK nor the route request can carry one. Resolving to the bare pooled
    // address would deliver funds nobody can attribute, so refuse instead.
    if (record.memo || record.memo_type) {
      return undefined
    }
    // The record comes from an arbitrary remote federation server. Re-apply the
    // G-address-only rule `isStellarAddress` exists to enforce.
    return StrKey.isValidEd25519PublicKey(record.account_id)
      ? record.account_id
      : undefined
  } catch {
    return undefined
  }
}
```

- [ ] **Step 6: Run the federation test to verify it passes**

```bash
pnpm --filter @lifi/sdk-provider-stellar test resolveStellarAddress
```

Expected: 6 passed.

- [ ] **Step 7: Write the failing passphrase-guard test**

Add to `packages/sdk-provider-stellar/src/core/StellarStepExecutor.unit.spec.ts`, inside the `checkWallet` describe:

```ts
    // Balances are simulated against the configured network while the envelope
    // is signed against the wallet's. A mismatch used to surface only as
    // txBAD_AUTH, after the user had signed.
    it('throws when the wallet is connected to a different network', () => {
      const executor = new StellarStepExecutor({
        wallet: {
          address: keypair.publicKey(),
          networkPassphrase: 'Test SDF Network ; September 2015',
          signTransaction: async () => ({ signedTxXdr: '' }),
        },
        networkPassphrase: 'Public Global Stellar Network ; September 2015',
        routeId: 'route-1',
      })

      const thrown = (() => {
        try {
          executor.checkWallet({
            action: { fromAddress: keypair.publicKey() },
          } as never)
        } catch (error) {
          return error
        }
      })()

      expect(thrown).toBeInstanceOf(TransactionError)
      expect((thrown as TransactionError).code).toBe(
        LiFiErrorCode.ChainSwitchError
      )
    })
```

- [ ] **Step 8: Run it to make sure it fails**

```bash
pnpm --filter @lifi/sdk-provider-stellar test StellarStepExecutor
```

Expected: FAIL — `checkWallet` compares only the address, so nothing is thrown.

- [ ] **Step 9: Add the guard and the shared default**

In `packages/sdk-provider-stellar/src/core/StellarStepExecutor.ts`, extend `checkWallet` with a second guard after the address check:

```ts
    // The provider resolves this from options first and the wallet second, so a
    // disagreement means the integrator configured one network while the user
    // connected to another. Signing would produce a txBAD_AUTH the user pays
    // for in a wasted signature.
    if (this.networkPassphrase !== this.wallet.networkPassphrase) {
      throw new TransactionError(
        LiFiErrorCode.ChainSwitchError,
        'The connected Stellar wallet is on a different network than the route.'
      )
    }
```

In `packages/sdk-provider-stellar/src/StellarProvider.ts`, add the exported constant above `isStellarAddress`:

```ts
/**
 * The network every read defaults to when the integrator configures none.
 * Signing prefers the connected wallet's passphrase instead, and
 * `StellarStepExecutor.checkWallet` refuses a route whose networks disagree.
 */
export const DEFAULT_NETWORK_PASSPHRASE: string = Networks.PUBLIC
```

and use it in `getBalance`, replacing `_options.networkPassphrase ?? Networks.PUBLIC` with:

```ts
        _options.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE
```

In `packages/sdk-provider-stellar/src/index.ts`, extend the provider export:

```ts
export {
  DEFAULT_NETWORK_PASSPHRASE,
  StellarProvider,
} from './StellarProvider.js'
```

- [ ] **Step 10: Run the executor test to verify it passes**

```bash
pnpm --filter @lifi/sdk-provider-stellar test StellarStepExecutor
```

Expected: 7 passed.

- [ ] **Step 11: Narrow the RPC imports to the subpath**

`@stellar/stellar-sdk/rpc` re-exports the `Api` namespace and `RpcServer as Server`. In each file below, replace `import { rpc } from '@stellar/stellar-sdk'` with `import { Api, Server } from '@stellar/stellar-sdk/rpc'`, drop `rpc` from any mixed import of the root entrypoint, and rewrite the usages:

| File | Replace | With |
|---|---|---|
| `src/client/getStellarRpc.ts` | `LruMap<rpc.Server>`, `new rpc.Server(`, `rpc.Server[]`, `server is rpc.Server` | `LruMap<Server>`, `new Server(`, `Server[]`, `server is Server` |
| `src/core/tasks/helpers/submitStellarTransaction.ts` | `rpc.Api.SendTransactionResponse` | `Api.SendTransactionResponse` |
| `src/core/tasks/helpers/waitForStellarTransaction.ts` | `rpc.Api.GetSuccessfulTransactionResponse`, `rpc.Api.GetTransactionStatus` | `Api.GetSuccessfulTransactionResponse`, `Api.GetTransactionStatus` |
| `src/core/tasks/helpers/probeStellarTransaction.ts` | `rpc.Api.GetTransactionStatus` | `Api.GetTransactionStatus` |
| `src/core/tasks/helpers/readAllowance.ts` | `rpc.Api.isSimulationSuccess`, `rpc.Api.isSimulationError` | `Api.isSimulationSuccess`, `Api.isSimulationError` |
| `src/actions/getStellarBalance.ts` | `rpc.Api.isSimulationSuccess` | `Api.isSimulationSuccess` |

Base primitives (`Account`, `Address`, `BASE_FEE`, `Contract`, `Networks`, `StrKey`, `TransactionBuilder`, `nativeToScVal`, `scValToNative`) stay on the root entrypoint: v16 vendors them under `lib/base/` and publishes no subpath for them.

The test files keep importing `rpc` from the root — they only need the `GetTransactionStatus` enum values, and the two entrypoints share one module instance.

- [ ] **Step 12: Run the full Stellar suite and the type check**

```bash
pnpm --filter @lifi/sdk build
pnpm --filter @lifi/sdk-provider-stellar test
pnpm check:types
```

Expected: every suite passes, and types check — including `StellarStepExecutor.unit.spec.ts` without its `signAuthEntry` stub, which is what proves Step 1 made the member optional.

- [ ] **Step 13: Measure the bundle again and compare**

```bash
pnpm --filter @lifi/sdk-provider-stellar build
npx esbuild /tmp/stellar-bundle/entry.js --bundle --format=esm --minify \
  --splitting --outdir=/tmp/stellar-bundle/after
wc -c /tmp/stellar-bundle/before/entry.js /tmp/stellar-bundle/after/*.js
```

Expected: the **after entry chunk** is smaller than the Step 0 baseline, and a second chunk appears holding `Federation` with the `StellarToml` resolver and TOML parser it drags in. The total across both chunks stays roughly the same — the point is that a consumer no longer loads the federation stack to swap.

State the claim in the PR description the way the measurement supports it: the dynamic import lets a code-splitting consumer (Vite, Rollup, webpack) leave `Federation` out of the initial chunk. A consumer who bundles without splitting sees no change. If the entry chunk did not shrink, some module still references `Federation` from the static graph — find it, and report the finding either way rather than quietly dropping it.

- [ ] **Step 14: Add the changeset line for the removed option**

Append to `.changeset/stellar-provider.md`:

```markdown
`StellarProviderOptions.horizonUrl` is gone — nothing read it — and `StellarWallet.signAuthEntry` is now optional, because the router routes use source-account auth and the SDK never calls it.
```

- [ ] **Step 15: Run the gate and commit**

```bash
pnpm check:write && pnpm build && pnpm check:types && pnpm test
git checkout -- packages/sdk/src/version.ts \
  packages/sdk-provider-bitcoin/src/version.ts \
  packages/sdk-provider-ethereum/src/version.ts \
  packages/sdk-provider-solana/src/version.ts \
  packages/sdk-provider-sui/src/version.ts \
  packages/sdk-provider-tron/src/version.ts
git add packages/sdk-provider-stellar/src .changeset/stellar-provider.md
git commit -m "fix(stellar): finalise the public surface before the first stable publish"
```

- [ ] **Step 16: Final whole-repo check**

```bash
pnpm knip:all
git diff origin/main...HEAD --stat -- "*version.ts"
git log --oneline origin/main..HEAD
```

Expected: knip reports nothing new; the version diff lists only `packages/sdk-provider-stellar/src/version.ts`; the log shows the merge plus six themed commits and the two docs commits.

---

## Coverage check

| Design section | Task |
|---|---|
| §5 version files | 1 |
| §6.1 base hook | 2 |
| §6.2 Stellar subclass + comment rewrite | 2 (hook), 5 (`run()` override) |
| §7.1 branch order | 3 |
| §7.2 classify outside the wrapper | 3 |
| §7.3 tests | 3 |
| §8.1 probe before re-submitting | 4 |
| §8.2 deadline | 4 |
| §8.3 transport failures inside the loop | 4 |
| §8.4 `TRY_AGAIN_LATER` retry | 4 |
| §9.1 one predicate | 5 |
| §9.2 `assertApprovalStillCovers` | 5 |
| §9.3 balance failure | 5 |
| §10.1 dead options | 6 |
| §10.2 federation memo + lazy import | 6 |
| §10.3 passphrase default + guard | 6 |
| §10.4 rpc subpath | 6 |
| §10.5 changeset | 2 and 6 |
| §11 verification | every task's final steps |

## Deviations from the design, and why

- **§9.2 uses `context.wallet.address`, not `step.action.fromAddress`.** `StellarCheckAllowanceTask` reads the allowance against `wallet.address`, so the re-check has to use the same account or it would read a different allowance. This also removes the missing-`fromAddress` guard the design sketched.
- **The probe lives in its own file**, `probeStellarTransaction.ts`, rather than inside `waitForStellarTransaction.ts`. `StellarWaitForTransactionTask.unit.spec.ts` mocks each helper module with a factory that returns one export; a second export in that module would force every existing mock factory to grow.
- **The base-task behaviour tests moved to `@lifi/sdk`.** `@lifi/sdk-provider-stellar` resolves `@lifi/sdk` to `packages/sdk/dist`, so a package-level mock cannot intercept the base task's own internal `getStepTransaction` import. Task 2 Step 1 covers that behaviour where the mock works, and the Stellar suite covers the override.
