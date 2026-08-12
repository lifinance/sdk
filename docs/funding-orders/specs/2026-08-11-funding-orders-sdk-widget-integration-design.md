# Funding Orders — SDK & Widget Checkout Integration

- **Date:** 2026-08-11
- **Status:** Approved design, pre-implementation
- **Repos affected:** `sdk` (this repo), `widget` (`packages/widget-checkout`, `packages/widget-provider`, provider adapter packages)
- **Backend contract:** `lifi-backend` branch `funding-orders` (read-only dependency; see `lifi-backend/docs/funding-api/funding-orders-api-design.md`)

## 1. Background

The backend now exposes a unified funding orders API:

- `POST /v1/funding/orders` — creates an order of type `STANDARD`, `SMART_DEPOSIT`, or `ONRAMP`. The response embeds the committed quote as a real `LiFiStep` (with `transactionRequest`), a top-level `depositAddress` for deposit flows, and an `onramp` block (with `widgetUrl`) for on-ramp flows.
- `GET /v1/funding/orders/{id}` — returns the order; accepts `?txHash=` (STANDARD, non-terminal only) to report the source transaction, and `?integrator=` for keyless partnerOrderId lookups. Clients poll this endpoint; there are no partner webhooks and no list endpoint.
- Helper endpoints: `POST /v1/funding/onramp/quote`, `POST /v1/funding/onramp/session`, `POST /v1/funding/onramp/fiat-currencies`, `POST /v1/funding/cex/session`.

Order lifecycle: `status` is a closed union `PENDING | DONE | FAILED`; `substatus` is an **open string** (known values include `ONRAMP_AWAITING_PAYMENT`, `INTENT_AWAITING_FUNDS`, `COMPLETED`, …). `DONE`/`FAILED` are terminal and never reopen. One order = one execution; a failed order is replaced by a new order with a new `partnerOrderId`. Idempotency: same `partnerOrderId` + byte-equal body replays with 200; a different body returns 422.

The widget's checkout UI (`@lifi/widget-checkout`, unpublished) currently integrates the pre-unification backend surface through a set of workarounds:

- a hand-rolled `fetch` client for the (now deleted) `/v1/checkout/*` endpoints (`widget-provider/src/checkout/utils/sessionClient.ts`, `api.ts`);
- a status poller that bypasses the SDK because `getStatus` cannot be called with a deposit address alone (`utils/depositAddressStatus.ts`);
- a mid-flight handoff that kills SDK route execution and switches to a hand-rolled deposit-address poller (`PendingCheckoutWalletHandoff` in `CheckoutTransactionPage.tsx`);
- a versioned localStorage "orders table" (`usePendingCheckoutStore`, `PENDING_RECORD_VERSION = 5`) with three separate writer paths;
- settings-store mutation hacks to force `smartDeposits` routes, plus ~10 `type: 'deposit'` special cases in widget core;
- `onSuccess`/`onError` that fire only for the cash/exchange sources, and at card-charge time rather than settlement.

The SDK (v4 beta, `@lifi/sdk` + six provider packages) executes everything through `executeRoute` with a generic task pipeline. `convertQuoteToRoute` already adapts a single `LiFiStep` into a synthetic route, and the Ethereum provider already swaps prepare/wait behavior per step shape (contract-calls flow, relayer flow). No funding concepts exist in the SDK or `@lifi/types` 17.x yet.

## 2. Goals

1. The SDK covers the full funding surface: order create/get/poll for all three types, plus the four helper endpoints.
2. `STANDARD` order execution reuses the existing route-execution machinery — allowance handling, signing, sending, status projection — with **no second execution layer**.
3. The widget checkout UI drops its raw `fetch` client, its bypass status subsystem, and its mid-flight execution handoff, and becomes a projection of SDK-owned order state.
4. `onSuccess`/`onError` fire on terminal order state for **all four** funding sources.

## 3. Non-goals

- No changes to `lifi-backend` (its `funding-orders` branch is the fixed contract).
- No upstreaming of types to `@lifi/types` yet (follow-up; see §9).
- No first-class "order container" refactor of the SDK core (`StatusManager`, `ExecutionActionType`, `executionState` remain route-shaped; see Approach C in §4).
- No changes to the legacy client-orchestrated session flow for external consumers; the widget simply stops using it.
- No Mesh CEX balance feature (`useMeshBalance.ts` stub is deleted, not finished).

## 4. Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | SDK scope | Full funding surface (orders + all four helper endpoints) |
| 2 | Wire types home | SDK-local (`packages/sdk/src/types/funding.ts`); upstream to `@lifi/types` later |
| 3 | Durable order state | Widget keeps a thin order-ID list; SDK stays stateless |
| 4 | Verification target | Local `lifi-backend` on `funding-orders`; mocked HTTP in CI |
| 5 | Execution shape | **Approach A**: order→route adapter + funding-aware pipeline slots |

Approaches considered for #5:

- **A (chosen):** `executeFundingOrder` wraps `executeRoute` through a synthetic route (the `convertQuoteToRoute` precedent) and swaps two pipeline slots by step predicate (the relayer-flow precedent). Minimal core changes, one execution layer.
- **B (rejected):** SDK ships actions only; the widget composes execution and polling. Re-creates today's problem: orchestration in the widget.
- **C (rejected for now):** generalize the SDK core so orders are a native execution container. Touches all six providers and the core state machine; high risk. Approach A keeps this open as a later refactor.

## 5. SDK design

### 5.1 Types — `packages/sdk/src/types/funding.ts`

- `FundingOrderType = 'STANDARD' | 'SMART_DEPOSIT' | 'ONRAMP'`
- `FundingOrderStatus = 'PENDING' | 'DONE' | 'FAILED'`
- `OnrampDelivery = 'DIRECT' | 'SMART_DEPOSIT'`
- `CreateFundingOrderRequest` — mirrors backend `CreateFundingOrderBody` (`partnerOrderId`, `type`, destination triple, optional source leg / fiat leg / `refundAddress` / `options: RouteOptions`). Per-type required/forbidden field rules documented in JSDoc (enforced server-side).
- `FundingOrder` — mirrors backend `PartnerFundingOrder`: `orderId`, `partnerOrderId`, `type`, `status`, `substatus?: string` (**open string, never a union**), `destination`, `quote?: LiFiStep`, `depositAddress?`, `onramp?` (`provider`, `delivery`, `widgetUrl?`, `fiatAmount`, `fiatCurrency`, `estimatedFundingAmount?`), `result?` (`fromTxHash?`, `toTxHash?`, `toAmount?`), `lateDelivery?`, `createdAt`, `updatedAt`. Optional fields are omitted by the backend, never `null`.
- Helper request/result types for on-ramp quote, on-ramp session, fiat currencies, and CEX session (shapes from `lifi-backend` `transak.types.ts`).

All exported from the SDK package root so the widget imports a single source.

### 5.2 Actions — `packages/sdk/src/actions/`

One file per endpoint, registered in `actions/index.ts` and exported from `src/index.ts`, following the existing `(client, params, options?) => Promise<T>` convention and the shared `request` util (which already injects auth/integrator headers):

- `createFundingOrder(client, body)` → `POST /funding/orders`. 200 and 201 both resolve to the order. Error mapping: 422 → `partnerOrderId` conflict (client bug — the caller must not retry with the same ID), 424 → on-ramp provider outage (retryable), 401 → keyless `ONRAMP` (configuration error), 400 → validation/unreachable destination.
- `getFundingOrder(client, id, { txHash?, integrator? })` → `GET /funding/orders/{id}`. `txHash` reporting is an idempotent additive write; the backend rejects a foreign hash with 400.
- `waitForFundingOrder(client, id, { pollingInterval = 10_000, timeout = 1_200_000, onUpdate? })` — polls until `DONE`/`FAILED`; resolves with the terminal order; calls `onUpdate(order)` on each status/substatus transition. Defaults match the backend reference scripts (10 s interval, 20 min ceiling). It never polls faster by default because each non-terminal read triggers a backend-side refresh. On timeout it rejects with a typed error while the order stays `PENDING` (resumable).
- Helpers: `getOnrampQuote`, `getOnrampFiatCurrencies`, `createOnrampSession`, `createCexSession` → the four `/funding/*` helper endpoints.

### 5.3 Execution — `executeFundingOrder`

New entry `executeFundingOrder(client, order, options?)` in the SDK core, dispatching on `order.type`:

**`STANDARD`** — full pipeline reuse:

1. `convertOrderToRoute(order)` (new util alongside `convertQuoteToRoute`) wraps `order.quote` in a synthetic route. The route ID **is** `order.orderId`, so widget state maps one-to-one without a lookup table. The synthetic step carries a `fundingOrderId` marker (SDK-local extension field).
2. `executeRoute` runs the normal provider pipeline: allowance check/approve (from `quote.estimate.approvalAddress`), sign, send. There is no permit/typed-data path — the backend rejects `options.gasless` for funding orders.
3. Two pipeline slots branch on the funding predicate (`fundingOrderId` present), following the existing `getUpdatedStep` / relayer-task precedent:
   - **Prepare slot:** never calls `/advanced/stepTransaction` — a funding order has no re-quote endpoint. It uses the stored `transactionRequest` as-is and fails with a typed error if it is missing. `stepComparison` (rate-change prompting) is skipped: the quote is committed at order creation.
   - **Wait slot:** a new `WaitForFundingOrderTask` replaces `WaitForTransactionStatusTask`. It first reports the source transaction via `getFundingOrder(orderId, { txHash })`, then polls the order endpoint (not `/v1/status`) to a terminal state, writing status/substatus transitions into the execution actions so `updateRouteHook` consumers see progress unchanged.
4. `DONE` → execution marked done with `order.result` (`toTxHash`, `toAmount`). `FAILED` → execution failed with the mapped substatus message.

**`SMART_DEPOSIT` / `ONRAMP`** — nothing to sign. `executeFundingOrder` delegates to `waitForFundingOrder` and forwards transitions through `options.onUpdate`. Rendering the QR code (`order.depositAddress`) or mounting the Transak `widgetUrl` is the caller's job.

**Resume** — `resumeFundingOrder(client, order)`:
- Re-fetches the order first; a terminal order returns immediately.
- `STANDARD` with no source transaction yet → resumes the pipeline like `resumeRoute` (provider resume-slicing applies unchanged).
- `STANDARD` with a source transaction already sent, and all other types → skips straight to order polling.

**Retry** — never in place. A `FAILED` order is replaced by a new order with a fresh `partnerOrderId` (backend rule: one order = one execution). `executeFundingOrder` rejects a terminal `FAILED` order.

### 5.4 Explicitly reused, unchanged

`TaskPipeline`, `BaseStepExecutor`, provider `SignAndExecute` tasks, allowance tasks, `StatusManager` (fed by the synthetic route), `executionState`, `stopRouteExecution`/`updateRouteExecution`, the `request` util, and error classes (`SDKError`, `HTTPError`, provider error parsers).

## 6. Widget design

### 6.1 Per-source flows

- **Wallet:** CTA → `createFundingOrder({ type: 'STANDARD', … })` → `executeFundingOrder`. The status page projects order state. `PendingCheckoutWalletHandoff` is deleted; the SDK owns the entire execution including settlement tracking.
- **Transfer:** CTA → `createFundingOrder({ type: 'SMART_DEPOSIT', refundAddress, … })`. QR page reads the top-level `order.depositAddress`. A TanStack Query poller wraps `getFundingOrder` (respecting the 10 s floor). The 30-minute frozen-quote snapshot (`useFrozenQuote`) is deleted — the order is the commitment and never expires server-side.
- **Cash:** pre-commit pages use `getOnrampFiatCurrencies` + `getOnrampQuote`. CTA → `createFundingOrder({ type: 'ONRAMP', fiatAmount, fiatCurrency, refundAddress, … })`. `TransakHost` mounts `order.onramp.widgetUrl` and no longer creates sessions itself. The widget captures `estimatedFundingAmount` from the **create** response (a later GET omits it). Requires an API key with Transak config; surfaced as a configuration error otherwise.
- **Exchange:** `createCexSession` provides the Mesh `linkToken`; the funding leg is a `SMART_DEPOSIT` order; Mesh pays into `order.depositAddress`; polling identical to transfer.

Pre-commit estimates on the amount page keep using the existing routes/quote display path; the committed quote always comes from the create response.

### 6.2 Deletions (replaced by the SDK surface)

| Deleted | Replaced by |
|---|---|
| `widget-provider/src/checkout/utils/sessionClient.ts`, `api.ts`, `CheckoutSdkBridge.tsx` | SDK actions (auth/base-URL come from the SDK client) |
| `utils/depositAddressStatus.ts`, `utils/statusPolling.ts`, `utils/statusHints.ts`, `utils/getSourceTxIdentifier.ts`, the poll selector + latch in `useCheckoutTransactionStatus.ts` | `getFundingOrder` / `waitForFundingOrder` (order status is server-reconciled) |
| `utils/extractDepositAddress.ts`, `types/checkoutRoute.ts` | Typed `order.depositAddress` |
| `hooks/useCheckoutFlowQuote.ts` (`getStepTransaction` + splice) | The create response embeds the committed quote |
| `PendingCheckoutWalletHandoff` (`CheckoutTransactionPage.tsx`) | `WaitForFundingOrderTask` inside SDK execution |
| `hooks/useFrozenQuote.tsx` | Order commitment |
| `hooks/useCheckoutExchangesOverride.ts` + the `CheckoutAppProvider` exchanges fork | Per-request quote options for pre-commit display; order types replace forced `smartDeposits` routing |
| `PendingRecord` schema + three writer paths (`usePendingCheckoutWriter.ts`, `PendingCheckoutPersistenceBridge.tsx`) | Thin ID list (§6.3) |
| `useMeshBalance.ts` stub and its call site | Deleted outright |

`CheckoutTransactionPage.tsx` (465 lines) collapses toward the shape of the widget's `TransactionPage.tsx` (111 lines): render-only, driven by execution/order state.

### 6.3 Persistence

`usePendingCheckoutStore` shrinks to a thin localStorage list of `{ orderId, fundingSource, createdAt }`. On load, the activity/resume view fans out `getFundingOrder` per ID (terminal orders are cheap, DB-served reads). A record is removed when the user acknowledges a terminal order, and pruned unconditionally after 7 days. No schema versioning needed — the order response is the schema.

### 6.4 Completion ownership

One observer watches terminal order state and fires `onSuccess(order)` / `onError(order | error)` for **all four** funding sources. The Transak card-charge event no longer triggers `onSuccess`; provider Hosts report into the order flow instead of owning completion.

### 6.5 Core widget & router cleanup

- Remove the `mode: 'custom' + type: 'deposit'` special cases across the ~10 widget-core files where the order flow makes them dead; verify each case individually (any case the pre-commit display still needs stays, with a comment naming the reason).
- Delete the unreachable `routes` router subtree and the `/progress` placeholder. `/transaction-execution` stays as the wallet interaction page (sign prompts); all post-send tracking for every funding source lives in a single order-status route.
- Keep: the page/component tree, i18n `checkout.*` namespace, theming, `CheckoutModal`/layout, the `OnRampProvider` adapter contract and `OnRampSessionsContext` registry, `useConnectedCexStore` (Mesh UX).

## 7. Error handling

- **`partnerOrderId`:** the widget generates a fresh UUID per order attempt; 422 therefore only signals a real client bug and surfaces as a typed SDK error.
- **424** (ONRAMP provider outage): retryable error UI, distinct from "destination unreachable" (400).
- **401** (keyless ONRAMP): configuration error, surfaced before amount entry when possible.
- **`FAILED` order:** show the mapped substatus message; the retry button creates a new order.
- **Unknown `substatus`:** falls back to a generic in-progress/failed message — the open union must never crash the UI. Known values get mapped copy (`ONRAMP_AWAITING_PAYMENT`, `ONRAMP_PROCESSING`, `ONRAMP_FAILED`, `ONRAMP_REFUNDED`, `INTENT_AWAITING_FUNDS`, `RECONCILIATION_REQUIRED`, plus the `/v1/status` crypto-phase vocabulary).
- **`lateDelivery`:** informational note only; never a status transition.
- **Poll timeout** (default 20 min): the order stays `PENDING`; the UI keeps the resume path alive.

## 8. Testing & verification

- **SDK (CI, mocked HTTP):** unit tests per action (including 200-vs-201, 422/424/401 mapping, `txHash` reporting); `convertOrderToRoute` adapter tests; funding-predicate tests for the prepare and wait slots; `executeFundingOrder` flows for all three types, resume from each phase, and failure paths.
- **Widget (CI):** hook/store tests for the order poller, the thin persistence list, and the single completion observer; router tests for the merged status route.
- **Live verification:** local `lifi-backend` on `funding-orders` (SDK `apiUrl` pointed at it) + playground `CheckoutWidgetView`. Wallet and transfer run end-to-end on a test chain; cash uses the Transak staging cards and `you+…@` email aliases from `lifi-backend/docs/funding-api/funding-orders-e2e-test-plan.md` (including the forced `ONRAMP_REFUNDED` / `ONRAMP_FAILED` paths).

## 9. Follow-ups (out of scope)

- Upstream the funding types to `@lifi/types` and align the SDK/widget/backend on one release line.
- Consider the first-class order container refactor (Approach C) once the flow is proven.
- Backend list endpoint / partner webhooks, Banxa provider — backend-side roadmap items; the design accommodates them without breaking changes (polling collapses into subscription, the ID list gains a server-backed source).
