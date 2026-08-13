# Funding Orders — Known Follow-Ups

Triage from the final whole-branch review of `feat/funding-orders-integration`, after the
post-review fix plan closed 14 findings. Everything here was assessed and consciously
**not** fixed on that branch. Nothing in this file blocks that merge.

Companion documents:

- `specs/2026-08-12-funding-orders-review-fixes-design.md` — the fix design, including three
  claims that implementation disproved (§3, §7.1).
- `plans/2026-08-12-funding-orders-review-fixes.md` — the executed plan.

## 1. Cross-repo dependencies — these are the ones that matter

### 1.1 The widget must persist `sourceTxHash` (required)

`resumeFundingOrder`'s double-send guard rests almost entirely on the caller supplying
`options.sourceTxHash`. The live-route layer barely helps: `stopRouteExecution` deletes the
`executionState` entry, and `executeSteps` calls it on every step outcome, so
`getActiveRoute` returns `undefined` after any pause, reload or completion.

The unguarded window is broadcast → receipt → first funding poll, which on a slow chain is
minutes. A reload inside it reaches the rebuild layer: `prepareRestart` no-ops on a route
with no `execution`, the pipeline restarts at `EthereumCheckBalanceTask`, and the funding
transaction is sent a second time. Only an insufficient balance mitigates it.

The SDK cannot close this itself — `resumeFundingOrder` receives an order, not a route. It
does provide the capture channel: `updateRouteHook` fires through `updateStepInRoute` when
the sign task writes `txHash`, and `allowUpdates` remains true in background mode.

**Action:** the widget writes `sourceTxHash` into its pending-orders list at broadcast time,
not after backend attribution. Gate the **widget** release on this, not the SDK merge.

### 1.2 The Permit2 opt-out depends on the backend refusing `gasless`

`estimate.skipPermit` closes `isPermit2Supported` and `EthereumNativePermitTask`, and
`convertOrderToRoute` now also strips `typedData` as defence-in-depth. Both rest on the
backend rejecting `gasless` for funding orders
(`lifi-backend` `FundingOrders/fundingOrders.quote.ts`). If a funding quote ever carries
server-supplied `typedData`, the strip is what prevents the relayer path from bypassing the
committed `transactionRequest` — `EthereumCheckPermitsTask` and `isRelayerStep` key on
`typedData` and neither reads `skipPermit`.

**Action:** if the backend ever supports gasless funding orders, revisit the strip before
relying on it.

## 2. Unenforced invariants

- **The wait-status task must stay last in every provider pipeline.** `WaitForFundingOrderTask`
  returns `COMPLETED` for a FAILED order (`TaskStatus` has no failure member, and throwing is
  the defect that was removed). `TaskPipeline` does not short-circuit on `COMPLETED`, so a task
  appended after the wait slot would run against a FAILED execution. A code comment marks this;
  no test asserts it. Five short per-provider assertions would gate it.
- **`getFundingOrderUpdatedStep`'s `estimate` override must follow the `...order.quote` spread.**
  Reversing them silently drops the `skipPermit` marker, and no type check catches it because
  `skipPermit` is optional.

## 3. Deliberate trade-offs, documented so they are not mistaken for bugs

- **`waitForFundingOrder` fast-fails on 400/401/404/422.** A transient client error on the order
  read *after* funds are broadcast marks the step FAILED rather than retrying. The order survives
  server-side and is resumable, but this is the sharpest edge of that choice.
- **`signal` is not wired into route execution.** On a STANDARD order it reaches only the funding
  poll, so an abort during allowance, signing or receipt has no effect until polling starts.
- **`onOrderUpdate` does not fire on early returns** — `executeFundingOrder`'s DONE return and
  `resumeFundingOrder`'s terminal-order return. The return value is authoritative (design D1), and
  firing would invent a transition that never happened.
- **Intermediate transitions are invisible to a concurrent resume.** The running wait task reports
  to the first caller's callback, so a second concurrent resume sees only the terminal event.
  Closing it would mean teaching `updateRouteExecution` to merge funding callbacks.
- **A FAILED action retains the `WAIT_DESTINATION_TRANSACTION` substatus.** This is load-bearing,
  not cosmetic: resume-after-FAILED is a real re-entry, and the Ethereum chain-check guard is
  skipped only while the substatus equals that sentinel. Writing `UNKNOWN_FAILED_ERROR` there
  would trip `checkClient` on every resume. **Do not "fix" it.**

## 4. Pre-existing issues this work surfaced but did not own

- `httpError.ts`'s bare `catch {}` in `buildAdditionalDetails` discards a body-parse failure
  silently, which is why the funding 422 message appends the server reason only *when present*.
- `request.ts` casts every caught error to `HTTPError`, so `SDKError.code` is a `DOMException`'s
  legacy `20` on an abort and `undefined` on a network failure. Neither is a `LiFiErrorCode`.
  (Harmlessly, this is also why an abort can never be mistaken for `LiFiErrorCode.Timeout`.)
- `request.ts`'s retry backoff calls `sleep(500)` without a signal, so it stays uncancellable.
- No repo gate type-checks spec files: `packages/sdk/tsconfig.json` excludes `./src/**/*.spec.ts`
  and vitest transpiles without checking. A type-level assertion inside a spec is documentation.
- Provider packages resolve `@lifi/sdk` through `dist/esm/index.d.ts`, with no `paths` or
  `references`. A signature changed in `packages/sdk/src` is invisible to them until a build.
- `pnpm build` rewrites the six `packages/*/src/version.ts` files, so they are perpetually dirty
  for anyone who builds.

## 5. Process note

The final review's own diagnosis, recorded because it generalises: **this process gated code and
had no gate on prose.** Mutation probes, madge sweeps and `as any` greps all target executable
behaviour — which is why no implementation defect survived, and why the two that did were a code
comment and a changeset sentence. Two rules follow:

1. Re-read every deferred item against the final tree before merge. A per-task review checks a
   diff against a brief; nothing checks the deferred queue.
2. Any "previously" in a changeset is verified against the last published tag, never against the
   branch. The false migration note in this branch's changeset was verified against the branch —
   correctly — and was still wrong, because the behaviour it described had never shipped.
