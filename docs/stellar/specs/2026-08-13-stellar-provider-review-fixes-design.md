# Stellar Provider — Post-Review Fix Design

- **Date:** 2026-08-13
- **Status:** Approved design, pre-implementation
- **Branch:** `feat/stellar-provider` (PR [#427](https://github.com/lifinance/sdk/pull/427)), head `c3280231`
- **Worktree:** `/Users/eugene/Projects/sdk-stellar-review`
- **Repos affected:** `sdk` (this repo) only. No backend change, no widget change.
- **Source of the findings:** high-effort `/code-review` of PR 427 (44 files, +2787/−6), 14 findings.

## 1. Background

PR 427 adds `@lifi/sdk-provider-stellar` and registers `ChainType.STL` in the SDK client. CI is
green, the branch carries one changeset, and the unit suites pass. A high-effort review then
produced 14 findings. Ten of them were re-verified against the source in this worktree before this
design was written; the remaining four are hygiene or type-surface items that need no verification
beyond reading the file.

Two facts frame every decision below.

**The package ships dark.** `GET /v1/chains?chainTypes=STL` returns an empty array today, so
`client.getRpcUrlsByChainId(ChainId.XLM)` throws for any integrator who does not configure
`rpcUrls` by hand. `getStellarBalance.int.spec.ts:25-28` records this as the reason its suite is
skipped. No runtime path in this package can reach a user until the backend serves STL chains.

**Nothing is frozen yet.** npm holds only `0.0.0-preview-*` throwaway builds:

```
0.0.0-preview-207d898  0.0.0-preview-3a18dab  0.0.0-preview-5e098f3  0.0.0-preview-c328023
```

No stable version exists, so the exported types can still change without a major bump.

Those two facts mean the pre-merge bar is not severity. It is *what costs more to change after
publish than before*. The decision in §4.1 nevertheless takes every finding in this PR, so the
distinction only shapes the ordering of the commits, not their contents.

## 2. Goals and non-goals

**Goals**

- Remove every path where a Stellar route fails after the user has signed, or reports a settled
  swap as failed.
- Make the provider's own error codes survive classification, so the widget shows a real cause
  instead of `UnknownError`.
- Freeze the public Stellar types in their final shape before the first stable publish.
- Stop `StellarPrepareTransactionTask` from forking the shared base task, which has already
  drifted (§3.3).
- Keep the PR diff to packages the PR actually touches.

**Non-goals**

- No backend change. Every fix works against the API as it exists.
- No un-skipping of the integration suites, and no new CI secrets (§4.3).
- No change to the pipeline task order. `StellarSetAllowanceTask` before
  `StellarPrepareTransactionTask` is load-bearing and stays (`StellarStepExecutor.ts:68-83`).
- No re-litigation of the provider's design. The SAC-address balance model, the three-way resume
  entry, and the per-leg approval resolution all stay.

## 3. Corrections to the review

Four of the review's claims are wrong or stale. Each was checked directly.

### 3.1 The bundle finding overstates the dependency set

The review claims the root `@stellar/stellar-sdk` import pulls `axios` and `commander` into every
consumer bundle. It does not, in v16.1.0:

- `axios` appears only in `lib/esm/http-client/axios-client.js`, reachable through the `./axios*`
  subpath exports. The default entrypoints use `feaxios`.
- `commander` appears only in `lib/esm/cli/index.js`. The root `index.js` never imports `cli`.

What the root import *does* pull is `StellarToml`, `Federation`, `WebAuth`, `Friendbot`, `Horizon`
and the bindings generator, all as static namespace re-exports. The package declares
`sideEffects: ["./lib/esm/base/scval.js", "./lib/cjs/base/scval.js"]` — a two-file allowlist — so a
tree-shaking bundler may drop the namespaces the consumer never references.

The real anchor is `Federation`: `lib/esm/federation/server.js:24` imports `Resolver` from
`../stellartoml/index.js`, which pulls `smol-toml`. `resolveStellarAddress` references `Federation`
from the static graph, so no bundler can drop that chain. §10.4 fixes exactly that.

### 3.2 `prepareRestart` does clear the transaction request

`StellarPrepareTransactionTask`'s doc comment claims:

> The retry path has the same problem: it resets `step.execution` but not `step.transactionRequest`.

That is wrong. `packages/sdk/src/core/prepareRestart.ts:26` sets `step.transactionRequest =
undefined` for every step, and `resumeRoute` calls `prepareRestart` (`core/execution.ts:78`). The
line has been there since #318 and is present on this branch.

The accurate scope of the unconditional refresh is narrower than the comment states. Of the three
entry paths, only one hands a stale envelope to the signer:

| Entry path | Step arrives with `transactionRequest`? | Base task behaviour |
|---|---|---|
| `getRoutes` | No | Always fetches fresh |
| `getQuote` + `convertQuoteToRoute` | **Yes** (`convertQuoteToRoute.ts:149`, `steps: [quote]`) | Never fetches |
| `resumeRoute` / retry | No (`prepareRestart.ts:26`) | Always fetches fresh |

So the Stellar override protects the `getQuote` path. On the other two the base guard already
produces a post-approval envelope, because the prepare task runs after the allowance tasks.

The override is still correct, and the *reason* it is needed is stronger than a clock:

- A Stellar envelope embeds the source account's **sequence number**. Any other transaction from
  that account invalidates it with `tx_bad_seq`. Waiting does not help.
- The Stellar pipeline **guarantees** such a transaction whenever an approval is needed:
  `StellarSetAllowanceTask` submits one before the prepare task runs. An envelope built before the
  approval is dead even if it is one second old.
- Timebounds of `[0, now + 300 s]` add a hard expiry on top.

For contrast, and to record why the other providers do not need this:

- **Ethereum already always re-fetches.** `EthereumPrepareTransactionTask.ts:51` calls
  `getUpdatedStep` with no `if (!step.transactionRequest)` guard on the non-funding branch.
- **EVM payloads survive age.** `transactionRequest` is `to`/`data`/`value`/gas. No nonce, no
  expiry; the wallet supplies the nonce at signing.
- **Solana is exposed and accepts it.** The payload embeds a blockhash valid for ~60–90 s.
  `SolanaSignAndExecuteTask.ts:70` wraps signing in `withTimeout(120_000)` and reports
  `TransactionExpired`; the retry then refreshes through `prepareRestart`.
- **Tron is exposed and accepts it.** Transactions carry `expiration` (~60 s). Tron also runs its
  allowance tasks before the base prepare task (`TronStepExecutor.ts:67-71`), but a Tron
  transaction has no per-account sequence, so its own approval does not invalidate the route
  payload. That is the difference from Stellar.
- **Bitcoin and Sui have no time expiry.** Their risk is a spent UTXO or an object-version
  conflict.

Commit 2 rewrites the comment to say this.

### 3.3 The altitude finding's rationale is stale, but the finding is now demonstrated

The review supports the "three branches fork the same base task" claim with
`PrepareTransactionTask.ts | 37 +-` on `feat/funding-orders-integration`. That is stale: `main` has
absorbed the funding-order branch, and `git diff origin/main...HEAD` on that file is now empty.

The finding is stronger than predicted, though. `main`'s `PrepareTransactionTask` now contains a
funding-order branch (`isFundingOrderStep` → `getFundingOrderUpdatedStep`) that the Stellar copy
does not have, and the branch is 9 commits behind. The drift is no longer hypothetical.

### 3.4 The committed `version.ts` files on `main` are stale placeholders

`main` carries `4.0.0-beta.11` in all six `version.ts` files while the `package.json` versions have
moved on:

| Package | `package.json` on `main` | `version.ts` on `main` |
|---|---|---|
| `sdk` | 4.3.0 | 4.0.0-beta.11 |
| `sdk-provider-bitcoin` | 4.0.5 | 4.0.0-beta.11 |
| `sdk-provider-ethereum` | 4.0.8 | 4.0.0-beta.11 |
| `sdk-provider-solana` | 4.0.5 | 4.0.0-beta.11 |
| `sdk-provider-sui` | 4.1.5 | 4.0.0-beta.11 |
| `sdk-provider-tron` | 4.0.5 | 4.0.0-beta.11 |

`node ../../scripts/version.js` regenerates each file on every `pnpm build`, so the published
artifact always carries the right value and the checked-in value is never read at publish time.
The branch's six modified files are therefore a local build's output, exactly as the review says —
but "restore them to the correct value" is not the fix. "Restore them to `main`'s content" is.

## 4. Decisions taken

### 4.1 All 14 findings land in PR 427

Chosen over a minimal merge plus a follow-up PR gated on the backend enabling STL chains. The
fixes are small and localized, the code is in context now, and `main` should not carry a known
resume defect even for a package that cannot yet execute.

### 4.2 A stale allowance throws before signing

When the post-refresh route needs a different allowance from the one already granted, the prepare
task throws. It does not loop back into the allowance tasks. The user loses one approval signature
and must request a new route, which re-runs the pipeline from the start and grants the correct
allowance. Rejected alternative: re-granting inside the pipeline needs a loop that `TaskPipeline`
does not support.

**Refinement to the approved sketch.** The question preview compared the refreshed requirement
against `context.approval`. The implementation reads the on-chain allowance instead:

```ts
const refreshed = resolveApprovalRequirement(step)
if (refreshed) {
  const allowance = await readAllowance(/* ... refreshed.tokenAddress, refreshed.spender ... */)
  if (allowance < refreshed.amount) { throw /* ... */ }
}
```

The comparison form has a false-failure mode. When `StellarCheckAllowanceTask` finds a sufficient
pre-existing allowance, no approval is submitted, and `context.approval` holds the *requirement*,
not the on-chain ceiling — which may be far larger. A refreshed amount slightly above the quote
would then throw on a route that would have worked. The read-based form is exact, catches a changed
spender or token for free (a new spender's allowance is `0`), and costs one read-only simulation on
Stellar steps that need an allowance. The user-visible behaviour is unchanged: throw before
signing.

### 4.3 Verification is unit tests only

One unit test per fix, with mocked RPC. The integration suites stay skipped until the backend
serves STL chains. No testnet rehearsal and no CI secrets.

### 4.4 Six themed commits after a `main` sync

`git merge origin/main` first — required both for the base-task hook to sit on current `main` and
to pick up the funding-order branch the Stellar fork lacks. Then one commit per theme, each
carrying its own tests, so any single fix stays reviewable and revertable.

## 5. Commit 1 — drop the unrelated `version.ts` files

`chore(stellar): keep generated version files out of the PR`

Restore six files to `origin/main`'s content:

```
packages/sdk/src/version.ts
packages/sdk-provider-bitcoin/src/version.ts
packages/sdk-provider-ethereum/src/version.ts
packages/sdk-provider-solana/src/version.ts
packages/sdk-provider-sui/src/version.ts
packages/sdk-provider-tron/src/version.ts
```

Keep `packages/sdk-provider-stellar/src/version.ts` — the package needs the file to build. Its
content is regenerated on every build, so its current `4.1.0` value is immaterial.

A later `pnpm build` in this worktree will dirty the six files again. That is the pre-existing
repo behaviour (see §3.4); the rule is simply not to stage them. Do not add them to `.gitignore`:
they are tracked, imported by source, and a fresh checkout must typecheck without a build.

## 6. Commit 2 — one hook on the shared prepare task

`refactor(sdk): add a refetch hook to PrepareTransactionTask`

### 6.1 `packages/sdk/src/core/tasks/PrepareTransactionTask.ts`

Add the hook, in the style `CheckBalanceTask.getCheckBalanceOptions` already establishes
(`CheckBalanceTask.ts:12-22`):

```ts
/**
 * Whether `run()` has to fetch a fresh transaction request. The default asks
 * only when the step has none, which keeps every existing provider unchanged.
 * Chains whose payload cannot be reused override it — see
 * `StellarPrepareTransactionTask`.
 */
protected shouldRefetchTransaction(context: StepExecutorContext): boolean {
  return !context.step.transactionRequest
}
```

Replace `if (!step.transactionRequest) {` with `if (this.shouldRefetchTransaction(context)) {`. The
funding-order branch and the re-quote branch inside it are untouched.

`isolatedDeclarations` needs the explicit `: boolean` return type, which the sketch has.
`PrepareTransactionTask` is already exported from the package entrypoint (`sdk/src/index.ts`), so
the provider can subclass it.

### 6.2 `packages/sdk-provider-stellar/src/core/tasks/StellarPrepareTransactionTask.ts`

Delete the copied `run()` body — 35 of its 40 lines are byte-identical to the base — and subclass:

```ts
export class StellarPrepareTransactionTask extends PrepareTransactionTask {
  protected override shouldRefetchTransaction(): boolean {
    return true
  }
}
```

That is the whole class in this commit. The allowance re-check is a separate concern and lands in
commit 5, which adds the `run()` override together with its helper (§9.2). Each commit therefore
leaves the tree green on its own.

Rewrite the doc comment to match §3.2:

- Keep reason 2 (the approval consumes the sequence number) as the load-bearing one.
- Replace the wrong retry-path claim with the accurate scope: the override protects the
  `getQuote` + `convertQuoteToRoute` path, because `prepareRestart` already clears
  `transactionRequest` on resume and the `getRoutes` path never carries one.
- Keep the timebounds note.

Two side effects worth recording: the fork stops drifting from `main`, and Stellar inherits the
funding-order branch for free.

`EthereumPrepareTransactionTask` extends `BaseStepExecutionTask` with genuinely different logic
(gas fees, typed data, execution strategy). It is not a fork of the base task and is not touched.

## 7. Commit 3 — error classification

`fix(stellar): keep classified errors classified`

Three coupled changes. Shipping any one alone regresses another: fixing §7.2 alone lets the
`TransactionError` escape the `AggregateError` and reach the `allowance` message match, which turns
a vague `UnknownError` into a confident and wrong `AllowanceRequired`.

### 7.1 `errors/parseStellarErrors.ts` — order the branches correctly

`handleSpecificErrors` currently matches message text before its `e instanceof BaseError`
passthrough at line 92, so it silently re-codes the provider's own errors. Restructure the head of
the function:

```ts
const handleSpecificErrors = (e: any): BaseError => {
  // The RPC failover wrapper collapses every rejection into an AggregateError.
  // Classify from the inner error it hides, preferring one the provider itself
  // already classified.
  if (e instanceof AggregateError && e.errors.length) {
    const inner = e.errors.find((error: unknown) => error instanceof BaseError)
    return handleSpecificErrors(inner ?? e.errors[0])
  }

  // Codes the provider set on purpose win over message matching.
  if (e instanceof BaseError) {
    return e
  }

  // ... existing message matching, unchanged ...
}
```

The message matching still covers every case it was written for: wallet-kit rejections arrive as
plain `Error`s or bare strings, and `tx_*` codes arrive inside RPC error messages.

### 7.2 `core/tasks/helpers/readAllowance.ts` — classify outside the failover wrapper

Build the envelope outside the callback and send only the simulation through
`callStellarRpcsWithRetry`, the shape `submitStellarTransaction.ts:33-36` and
`waitForStellarTransaction.ts:25-27` already use:

```ts
const source = new Account(from, '0')
const transaction = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase })
  .addOperation(/* ... unchanged ... */)
  .setTimeout(30)
  .build()

const simulation = await callStellarRpcsWithRetry(client, (server) =>
  server.simulateTransaction(transaction)
)

if (!rpc.Api.isSimulationSuccess(simulation) || !simulation.result) {
  throw new TransactionError(LiFiErrorCode.TransactionSimulationFailed, /* ... */)
}
```

Reusing one built envelope across servers is correct — the simulation is read-only and carries a
zero sequence number.

Update the comment: it currently claims the throw is placed so `parseStellarErrors` passes it
through, which is the opposite of what the code does.

### 7.3 Tests

- A provider-thrown `TransactionError(TransactionSimulationFailed, '...allowance...')` keeps its
  code instead of becoming `AllowanceRequired`.
- An `AggregateError` wrapping a wallet rejection classifies as `SignatureRejected`.
- An `AggregateError` wrapping a classified `TransactionError` returns that error unchanged.
- A failed `readAllowance` simulation surfaces `TransactionSimulationFailed`, not `UnknownError`.

## 8. Commit 4 — submit and confirm resilience

`fix(stellar): make submission and confirmation survive transient failures`

### 8.1 `StellarWaitForTransactionTask` — probe before re-submitting

The resume path re-submits the persisted envelope unconditionally (line 54). Once the transaction
has been applied, the sequence number is consumed, the re-submit fails with `txBAD_SEQ` (or
`txTOO_LATE` past 300 s), and `BaseStepExecutor` marks a settled swap `FAILED`.

Probe first, and let the poll decide the outcome:

```ts
let resubmitError: unknown

if (!transactionHash && action.txHex) {
  const probe = await probeStellarTransaction(client, hash)
  if (probe !== 'landed') {
    try {
      await submitStellarTransaction(client, action.txHex, networkPassphrase)
    } catch (error) {
      // The poll below is the source of truth. A settled transaction must not
      // fail here, and a genuinely dead envelope surfaces via §8.2. Keep the
      // error only when the probe was definite: after a failed probe this may
      // be a txBAD_SEQ from a swap that already succeeded.
      resubmitError = probe === 'not-found' ? error : undefined
    }
  }
}
```

`probeStellarTransaction` is a new helper next to `waitForStellarTransaction`. It returns a
three-way result, because "the probe failed" and "the network does not know this hash" must not be
collapsed:

- `SUCCESS` or `FAILED` → `'landed'`. Skip the re-submit; the poll reports the real outcome.
- `NOT_FOUND` → `'not-found'`. Still ambiguous — never broadcast, or broadcast and pending — so
  re-submit. That is safe: submission is idempotent by hash and answers `DUPLICATE`.
- A transport failure → `'unknown'`. Re-submit for the same reason, but do not trust any error it
  produces.

To keep the diagnosis accurate when the envelope truly never reached the network, prefer the
swallowed submit error over a bare timeout — and only then:

```ts
try {
  await waitForStellarTransaction(client, hash, pollingIntervalMs)
} catch (error) {
  if (resubmitError && error instanceof BaseError && error.code === LiFiErrorCode.Timeout) {
    throw resubmitError
  }
  throw error
}
```

The `'unknown'` branch is what keeps this honest. Without it, an outage that outlasts the 330 s
budget would surface the swallowed `txBAD_SEQ` — a `TransactionConflict` for a route that in fact
settled — instead of the timeout, which is strictly worse than the bug this section fixes.

### 8.2 `waitForStellarTransaction` — a deadline instead of an attempt count

`CONFIRM_POLL_ATTEMPTS = 30` at `CONFIRM_POLL_INTERVAL_MS = 3_000` gives a 90 s budget against
300 s timebounds, so the task can give up while the envelope is still live. Replace the attempt
count with a deadline that outlives the timebounds:

```ts
/** Outlives the backend's `[0, now + 300 s]` timebounds, so a transaction that
 *  has not been applied by the deadline is genuinely dead. */
const CONFIRM_TIMEOUT_MS = 330_000
```

Loop while `Date.now() < deadline`. The interval stays configurable through `pollingIntervalMs`, so
the budget no longer depends on it.

### 8.3 `waitForStellarTransaction` — tolerate transport failures inside the loop

`callStellarRpcsWithRetry` throws `AggregateError` the moment every configured server rejects one
read. Today that propagates straight out of the loop, so a single rate-limit burst ends the wait
and fails the step while the transaction is still pending. Wrap the read:

```ts
try {
  const response = await callStellarRpcsWithRetry(/* ... */)
  // ... SUCCESS / FAILED handling unchanged ...
} catch (error) {
  lastTransportError = error
}
await new Promise((resolve) => setTimeout(resolve, pollingIntervalMs))
```

On deadline exit, throw `TransactionError(Timeout, ...)` with `cause: lastTransportError` when one
was seen. `BaseError`'s constructor types `cause` as `Error`, and `callStellarRpcsWithRetry` throws
`AggregateError`, so the value passes through unchanged; coerce anything else with
`new Error(String(error))`.

### 8.4 `submitStellarTransaction` — retry `TRY_AGAIN_LATER`

`TRY_AGAIN_LATER` is stellar-core's explicit "valid, not queued, resubmit" signal. Treating it as
terminal turns congestion into a route failure — and worse, `StellarSignAndExecuteTask` has already
persisted the hash and envelope before this throw, so the resumed route polls for a transaction
that never reached the network.

Retry the same envelope up to 3 times with a 2 s delay, then throw `RateLimitExceeded` as it does
now. Resubmission is idempotent by hash, so a retry is safe. `PENDING` and `DUPLICATE` stay
successes; the `default:` branch stays terminal.

### 8.5 Tests

- Resume with a landed transaction: `probeStellarTransaction` returns `'landed'`,
  `submitStellarTransaction` is never called, the step completes.
- Resume with `'not-found'`: the envelope is re-submitted, then the poll completes.
- Resume where the re-submit throws and the poll then succeeds: the step completes, no error.
- Resume with `'not-found'` where the re-submit throws and the poll times out: the submit error
  surfaces, not `Timeout`.
- Resume with `'unknown'` where the re-submit throws and the poll times out: `Timeout` surfaces,
  and the swallowed `txBAD_SEQ` does not.
- The poll survives one all-RPC failure and succeeds on the next interval.
- The poll spends the full 330 s budget with fake timers, then throws `Timeout` carrying the last
  transport error as `cause`.
- `TRY_AGAIN_LATER` twice then `PENDING` returns the hash; four times throws
  `RateLimitExceeded`.

## 9. Commit 5 — approval and balance correctness

`fix(stellar): resolve and re-check the approval a route really needs`

### 9.1 `resolveApprovalRequirement` — one predicate

`find` currently selects the first leg without `skipApproval: true` and then abandons the whole
step if that leg's spender is not a `C`-address (lines 40-53), so a later leg that genuinely needs
the allowance never gets one. Merge the conditions:

```ts
const includedStep = step.includedSteps?.find(
  (includedStep) =>
    !includedStep.estimate.skipApproval &&
    includedStep.estimate.approvalAddress &&
    StrKey.isValidContract(includedStep.estimate.approvalAddress)
)
if (!includedStep) {
  return undefined
}
const spender = includedStep.estimate.approvalAddress as string
```

The comment explaining why a non-`C` spender is skipped moves onto the predicate.

Add the case the suite is missing: `resolveApprovalRequirement.unit.spec.ts:82-96` only feeds
single-leg steps to the non-contract-spender case. Add
`[leg with a G-address spender and no skipApproval, cctpLeg]` and assert the CCTP leg wins.

### 9.2 `assertApprovalStillCovers` — a new helper, and the `run()` override

`StellarPrepareTransactionTask` replaces `includedSteps` and `estimate` wholesale after the
allowance was granted from the pre-refresh step (line 61), and nothing re-validates it. This commit
adds the check to the class commit 2 reduced to a single hook override:

```ts
export class StellarPrepareTransactionTask extends PrepareTransactionTask {
  protected override shouldRefetchTransaction(): boolean {
    return true
  }

  override async run(context: StellarStepExecutorContext): Promise<TaskResult> {
    const result = await super.run(context)
    await assertApprovalStillCovers(context)
    return result
  }
}
```

Narrowing the `run` parameter type from `StepExecutorContext` to `StellarStepExecutorContext` is
allowed: TypeScript method parameters are bivariant, and the class already relies on this against
`BaseStepExecutionTask` today. The check runs after `super.run()` even when the result is `PAUSED`;
a paused step re-enters the task later and re-checks, and detecting the mismatch early is harmless.

Add `core/tasks/helpers/assertApprovalStillCovers.ts`:

```ts
/**
 * Fails the step before signing when the refreshed route needs an allowance the
 * sender does not have. `StellarPrepareTransactionTask` re-quotes after
 * `StellarSetAllowanceTask` has already written one, so a re-quote that names a
 * different spender, a different intermediate token, or a larger amount would
 * revert `transfer_from` on-chain after a second signature.
 */
export const assertApprovalStillCovers = async (
  context: StellarStepExecutorContext
): Promise<void> => {
  // Nothing was resolved before the refresh, so there is no grant to invalidate
  // and no read to pay for. This is the whole `getRoutes` path, where the base
  // guard already fetched the envelope after the allowance tasks.
  if (!context.approval) {
    return
  }
  const refreshed = resolveApprovalRequirement(context.step)
  if (!refreshed) {
    return
  }
  const from = context.step.action.fromAddress
  // ... guard a missing fromAddress with TransactionError(InternalError) ...
  const allowance = await readAllowance(
    context.client,
    refreshed.tokenAddress,
    from,
    refreshed.spender,
    context.networkPassphrase
  )
  if (allowance < refreshed.amount) {
    throw new TransactionError(
      LiFiErrorCode.TransactionUnprepared,
      'The refreshed Stellar route needs a different token allowance. Please request a new route.'
    )
  }
}
```

`TransactionUnprepared` over `AllowanceRequired`: the widget's remedy is a new route, not another
approval prompt at this point in the pipeline. `readAllowance` already returns `0n` for an absent
entry, so a changed spender or token fails this check without a special case.

### 9.3 `getStellarBalance` — do not hide a total failure

The comment at line 54 asserts that every token must carry a `blockNumber`, and the code breaks
that invariant whenever every read fails — the current default state, because
`getRpcUrlsByChainId(ChainId.XLM)` throws. Consumers then read a missing `blockNumber` as an
unsettled read and poll forever instead of surfacing the failure.

Keep the read errors instead of discarding them with `.catch(() => undefined)`. If **every** token
read failed, throw the first error. If at least one succeeded, keep the current behaviour: the
failed tokens borrow the batch's newest ledger as their `blockNumber` and carry no `amount`.

### 9.4 Tests

- `[G-address-spender leg, cctpLeg]` resolves the CCTP leg's spender, token and buffered amount.
- A leg whose `approvalAddress` is missing is skipped, not fatal.
- `assertApprovalStillCovers`: passes when the on-chain allowance covers the refreshed amount;
  throws when the spender changed (allowance reads `0n`); throws when the refreshed amount exceeds
  the allowance; returns early when the refreshed route needs no approval; and reads nothing at all
  when `context.approval` is unset.
- `getStellarBalance`: throws when every read fails; keeps the fallback `blockNumber` when one
  read succeeds.

## 10. Commit 6 — public surface and bundle

`fix(stellar): finalise the public surface before the first stable publish`

### 10.1 `types.ts` — remove what nothing reads

- Delete `StellarProviderOptions.horizonUrl`. `grep` finds no reader; every balance, allowance and
  approve path goes through `callStellarRpcsWithRetry` unconditionally. Its documented fallback
  does not exist, so an integrator who sets it gets a silent no-op on a published API.
- Make `StellarWallet.signAuthEntry` optional. The SDK never calls it, yet every widget adapter
  must currently ship a stub — `StellarStepExecutor.unit.spec.ts:19` already writes one. Keep the
  member and `StellarSignedAuthEntry`: they document the Stellar Wallets Kit surface at no cost.

Run `pnpm knip:all` afterwards. No GitHub workflow invokes knip, but the husky `pre-commit` hook
runs `pnpm pre-commit`, which ends in `pnpm knip:check` — the `--dependencies --files` variant,
which reports unused files and dependencies rather than unused exports. `StellarSignedAuthEntry`
stays reachable either way, because `src/index.ts` re-exports it as public API.

### 10.2 `resolveStellarAddress` — refuse a lossy resolution

`Federation.Api.Record` carries `account_id`, `memo_type?` and `memo?`. SEP-2 records for custodial
destinations return a pooled `account_id` plus a memo that the deposit MUST carry. Returning the
bare address sends funds to an exchange's omnibus account with no attribution — an unrecoverable
loss.

```ts
const { Federation } = await import('@stellar/stellar-sdk')
const record = await Federation.Server.resolve(name)
// A memo is part of the destination, and neither the SDK nor the route request
// can carry one. Refuse rather than resolve to an address that loses funds.
if (record.memo || record.memo_type) {
  return undefined
}
// The record comes from an arbitrary remote federation server. Re-apply the
// G-address-only rule `isStellarAddress` exists to enforce.
return StrKey.isValidEd25519PublicKey(record.account_id)
  ? record.account_id
  : undefined
```

The dynamic `import()` is what removes `Federation` — and with it `StellarToml` and `smol-toml` —
from the initial chunk. Tree-shaking works per export binding, so once no static import references
the `Federation` export, a bundler can drop it even though other modules still import the root
entrypoint for `StrKey` and friends (§3.1). Returning `undefined` is the right failure shape:
`getNameServiceAddress` already swallows throws and returns `undefined`
(`actions/getNameServiceAddress.ts:28-40`), so a thrown error would gain nothing there.

### 10.3 Network passphrase — one default and a signing guard

`getBalance` defaults to `Networks.PUBLIC` (`StellarProvider.ts:45`) while `getStepExecutor`
defaults to `wallet.networkPassphrase` (line 58), and `checkWallet` compares only the address. A
mainnet envelope signed with a testnet passphrase is rejected as `txBAD_AUTH` after the user has
signed.

- Add an exported `DEFAULT_NETWORK_PASSPHRASE = Networks.PUBLIC` and use it for the `getBalance`
  default, so the two defaults are visibly the same constant.
- Add a guard to `StellarStepExecutor.checkWallet`:

```ts
if (this.networkPassphrase !== this.wallet.networkPassphrase) {
  throw new TransactionError(
    LiFiErrorCode.ChainSwitchError,
    'The connected Stellar wallet is on a different network than the route.'
  )
}
```

**Recorded limit.** The guard fires only when `options.networkPassphrase` was set explicitly and
disagrees with the wallet. It closes the signing gap, not the balance gap: with no option set, an
integrator whose wallet is on TESTNET still reads mainnet balances. Closing that would mean calling
`getWallet()` from `getBalance`, which would force a wallet connection for a read. Documented in the
option's TSDoc instead.

### 10.4 Import the RPC namespace from its subpath

`@stellar/stellar-sdk` v16 exposes `.`, `./contract`, `./rpc`, `./axios*` and
`./http-client/axios`. `./rpc` re-exports the `Api` namespace and `RpcServer as Server`, so the
four RPC modules can take:

```ts
import { Api, Server } from '@stellar/stellar-sdk/rpc'
```

Files: `client/getStellarRpc.ts`, `core/tasks/helpers/submitStellarTransaction.ts`,
`core/tasks/helpers/waitForStellarTransaction.ts`, `core/tasks/helpers/readAllowance.ts`,
`actions/getStellarBalance.ts`. Base primitives (`Account`, `Address`, `BASE_FEE`, `Contract`,
`Networks`, `StrKey`, `TransactionBuilder`, `nativeToScVal`, `scValToNative`) stay on the root
entrypoint: v16 vendors them under `lib/base/` and publishes no subpath for them.

Evidence, not a CI gate: bundle a one-line entry that imports the provider with esbuild
(`--bundle --format=esm --minify`) before and after the commit, and record both sizes in the PR
description.

### 10.5 Changeset

Add a line to `.changeset/stellar-provider.md` about the new `shouldRefetchTransaction` hook on
`PrepareTransactionTask`. The file already declares `@lifi/sdk` **minor**, which covers an additive
protected hook, so no new changeset and no bump change is needed.

## 11. Verification

Per §4.3, unit tests only. At every commit, in the order `.github/workflows/tests.yaml` uses:

```
pnpm check:write && pnpm build && pnpm check:types && pnpm test
```

`pnpm build` has to precede `pnpm test`, because the provider packages resolve `@lifi/sdk` to
`packages/sdk/dist`. There is no `pnpm lint`; biome runs as `pnpm check` (CI) or `pnpm check:write`
(local). The husky `pre-commit` hook additionally runs `pnpm check:types`,
`pnpm check:circular-deps` and `pnpm knip:check` on every commit, and `commit-msg` runs commitlint,
so commit subjects must stay conventional.

Plus, once at the end: `pnpm knip:all` (§10.1) and the esbuild measurement (§10.4).

The integration suites stay skipped. `getStellarBalance.int.spec.ts`'s skip comment stays accurate
and needs no edit.

## 12. Out of scope, and follow-ups to record

- **`latest` on npm points at a preview build.** `@lifi/sdk-provider-stellar@latest` currently
  resolves to `0.0.0-preview-5e098f3`, so a plain `npm i` installs a throwaway build. Fix the
  dist-tag at real publish time; it is a release action, not a code change.
- **Confirm `4.1.0` is the intended starting version.** The package's `package.json` says `4.1.0`,
  and the changeset's minor bump would first publish `4.2.0`. If the intent was to start elsewhere,
  change it before the Version PR.
- **A Stellar funding order would still sign a stale envelope.** With the hook returning `true`,
  a funding-order step takes the base task's funding branch, which restores the order's *committed*
  quote — an envelope minted when the order was created, with a sequence number that has almost
  certainly moved. Funding orders do not exist for Stellar today. Record it; do not build for it.
- **`@lifi/data-types` is pinned at `^6.82.4`** in this package while the other six use `^6.83.0`.
  Align it in a separate dependency bump.
- **A stray `waitForStellarTransaction` key** sits inside the `submitStellarTransaction.js` mock in
  `StellarSignAndExecuteTask.unit.spec.ts:24-28`. Harmless; clean up when touching that file.
- **The approve transaction hard-codes `BASE_FEE`** as its inclusion fee. Revisit when the backend
  serves STL chains and real congestion data exists.

## 13. Risks

- **The `main` merge may conflict.** The branch is 9 commits behind, and `main` has changed
  `PrepareTransactionTask`. Resolve the merge before commit 1, and keep the merge in its own commit.
- **The hook changes shared SDK behaviour.** The default preserves `!step.transactionRequest`
  exactly, so Bitcoin, Solana, Sui and Tron are unaffected. The `@lifi/sdk` unit suite is the gate.
- **`assertApprovalStillCovers` adds one RPC read** to every Stellar step that needs an allowance.
  Accepted: it replaces a post-signature on-chain revert with a pre-signature error.
- **The 330 s confirmation budget lengthens the worst-case wait** from 90 s to 330 s. Accepted:
  giving up while the envelope is still live is worse, and §8.1 stops a timeout from turning a
  settled swap into a failure.
- **The `./rpc` subpath could break typings** under `isolatedDeclarations`. `pnpm build` catches it;
  reverting §10.4 alone is safe if it does.

## 14. Finding → commit map

| # | Finding | File | Commit |
|---|---|---|---|
| 1 | Resume re-submits an already-applied envelope | `StellarWaitForTransactionTask.ts:54` | 4 (§8.1) |
| 2 | Approval predicate bails on a non-`C` first leg | `resolveApprovalRequirement.ts:40` | 5 (§9.1) |
| 3 | Classified error collapsed into `AggregateError` | `readAllowance.ts:48` | 3 (§7.2) |
| 4 | Federation memo dropped, `account_id` unvalidated | `resolveStellarAddress.ts:19` | 6 (§10.2) |
| 5 | Granted allowance not re-checked after the re-quote | `StellarPrepareTransactionTask.ts:61` | 5 (§9.2) |
| 6 | `blockNumber` invariant breaks when every read fails | `getStellarBalance.ts:57` | 5 (§9.3) |
| 7 | Message matching overrides the provider's own codes | `parseStellarErrors.ts:76` | 3 (§7.1) |
| 8 | One RPC outage aborts the whole confirmation poll | `waitForStellarTransaction.ts:25` | 4 (§8.3) |
| 9 | `TRY_AGAIN_LATER` treated as terminal | `submitStellarTransaction.ts:42` | 4 (§8.4) |
| 10 | Read and signing passphrases can differ | `StellarProvider.ts:45` | 6 (§10.3) |
| 11 | Prepare task copy-pasted to drop one guard | `StellarPrepareTransactionTask.ts:29` | 2 (§6) |
| 12 | Six unrelated generated `version.ts` files committed | `sdk/src/version.ts:2` | 1 (§5) |
| 13 | `horizonUrl` and `signAuthEntry` are dead surface | `types.ts:68` | 6 (§10.1) |
| 14 | Root `stellar-sdk` import inflates consumer bundles | `StellarProvider.ts:11` | 6 (§10.2, §10.4) |

Also fixed along the way, from §3.2 and §8.2: the wrong retry-path claim in the prepare task's
comment, and the 90 s confirmation budget against 300 s timebounds.
