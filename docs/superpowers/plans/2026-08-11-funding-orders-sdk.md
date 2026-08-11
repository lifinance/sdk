# Funding Orders SDK Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the unified funding orders surface (types, actions, `executeFundingOrder`) to `@lifi/sdk`, reusing the existing route-execution machinery with no second execution layer.

**Architecture:** New wire types + one action file per endpoint follow the existing `actions/` pattern. A `STANDARD` order executes through `executeRoute` via a `convertOrderToRoute` adapter (the `convertQuoteToRoute` precedent); two hub tasks (`PrepareTransactionTask`, `WaitForTransactionStatusTask`) gain a funding branch selected by an `isFundingOrderStep` predicate (the relayer-flow precedent). `SMART_DEPOSIT`/`ONRAMP` orders only poll.

**Tech Stack:** TypeScript (strict, `isolatedDeclarations: true`), pnpm monorepo, vitest + msw (`*.unit.spec.ts`), Biome, Changesets.

**Spec:** `docs/superpowers/specs/2026-08-11-funding-orders-sdk-widget-integration-design.md` (§5, §7, §8 are the SDK sections). Backend contract reference: `/Users/eugene/Projects/lifi-backend` branch `funding-orders`, `apps/backend-api/src/packages/FundingOrders/fundingOrders.types.ts` and `docs/funding-api/funding-orders-api-design.md`.

## Global Constraints

- `isolatedDeclarations: true` — every exported function needs an explicit return type annotation.
- No default exports in library code.
- Test files are named `*.unit.spec.ts`; shared fixtures `*.unit.mock.ts`; msw handlers live in `packages/sdk/src/actions/actions.unit.handlers.ts` (`setupTestServer()` pattern).
- Run tests with `pnpm --filter @lifi/sdk test:unit` (or `pnpm test:unit` at root). Type-check with `pnpm check:types`. Lint with `pnpm check` (Biome). All run automatically on commit via husky.
- Commits follow the repo's scoped conventional style (`feat(funding): …`, `test(funding): …`).
- Every publishable change needs a Changesets entry (`feat:` → **minor**). One changeset at the end covers the PR (Task 10).
- `substatus` on orders is an **open string** — never type it as a union.
- `waitForFundingOrder` polls at ≥10 s by default (each non-terminal read triggers a backend-side refresh).
- The working branch is `feat/funding-orders-integration` in `/Users/eugene/Projects/sdk`.

## File Map

| File | Responsibility |
|---|---|
| Create `packages/sdk/src/types/funding.ts` | All funding wire types |
| Create `packages/sdk/src/actions/createFundingOrder.ts` | `POST /funding/orders` |
| Create `packages/sdk/src/actions/getFundingOrder.ts` | `GET /funding/orders/{id}` |
| Create `packages/sdk/src/actions/waitForFundingOrder.ts` | Terminal-state polling loop |
| Create `packages/sdk/src/actions/getOnrampQuote.ts` | `POST /funding/onramp/quote` |
| Create `packages/sdk/src/actions/getOnrampFiatCurrencies.ts` | `POST /funding/onramp/fiat-currencies` |
| Create `packages/sdk/src/actions/createOnrampSession.ts` | `POST /funding/onramp/session` |
| Create `packages/sdk/src/actions/createCexSession.ts` | `POST /funding/cex/session` |
| Create `packages/sdk/src/actions/fundingOrders.unit.mock.ts` | Shared order fixtures |
| Create `packages/sdk/src/utils/fundingOrderStep.ts` | `isFundingOrderStep`, `getFundingOrderUpdatedStep` |
| Create `packages/sdk/src/utils/convertOrderToRoute.ts` | Order → synthetic Route adapter |
| Create `packages/sdk/src/core/tasks/WaitForFundingOrderTask.ts` | Funding wait slot (report txHash + poll order) |
| Create `packages/sdk/src/core/fundingExecution.ts` | `executeFundingOrder`, `resumeFundingOrder` |
| Modify `packages/sdk/src/types/core.ts` | `fundingOrderId?: string` on `LiFiStepExtended` |
| Modify `packages/sdk/src/errors/httpError.ts` | 401/422 status classification |
| Modify `packages/sdk/src/core/tasks/PrepareTransactionTask.ts` | Funding branch (no re-quote) |
| Modify `packages/sdk/src/core/tasks/WaitForTransactionStatusTask.ts` | Delegate to funding wait task |
| Modify `packages/sdk/src/actions/index.ts`, `packages/sdk/src/index.ts` | Registration + exports |
| Modify `packages/sdk/src/actions/actions.unit.handlers.ts` | msw handlers for `/funding/*` |
| Modify `packages/sdk-provider-ethereum/src/core/tasks/helpers/getUpdatedStep.ts` | Funding branch |

---

### Task 1: Funding wire types

**Files:**
- Create: `packages/sdk/src/types/funding.ts`
- Modify: `packages/sdk/src/index.ts`

**Interfaces:**
- Produces: every type below, exported from `@lifi/sdk`. Later tasks import them via `../types/funding.js`.

Pure types — no runtime, so no unit test; the gate is `pnpm check:types`.

- [ ] **Step 1: Write the types module**

Create `packages/sdk/src/types/funding.ts`:

```ts
import type { LiFiStep, RouteOptions } from '@lifi/types'

export type FundingOrderType = 'STANDARD' | 'SMART_DEPOSIT' | 'ONRAMP'

/** Closed union. Terminal states never reopen. */
export type FundingOrderStatus = 'PENDING' | 'DONE' | 'FAILED'

export type OnrampDelivery = 'DIRECT' | 'SMART_DEPOSIT'

export interface CreateFundingOrderRequest {
  /** Idempotency key, 1-255 chars, unique per integrator scope. */
  partnerOrderId: string
  type: FundingOrderType
  toChainId: number
  toTokenAddress: string
  toAddress: string
  /** Required for STANDARD and SMART_DEPOSIT. Forbidden for ONRAMP. */
  fromChainId?: number
  /** Required for STANDARD and SMART_DEPOSIT. Forbidden for ONRAMP. */
  fromTokenAddress?: string
  /** Base units. Required for STANDARD and SMART_DEPOSIT. Forbidden for ONRAMP. */
  fromAmount?: string
  /** Required for STANDARD. */
  fromAddress?: string
  /** Required for SMART_DEPOSIT and ONRAMP. */
  refundAddress?: string
  /** Human-decimal fiat amount. Required for ONRAMP. */
  fiatAmount?: string
  /** Required for ONRAMP, e.g. "EUR". */
  fiatCurrency?: string
  paymentMethod?: string
  countryCode?: string
  /** Same RouteOptions as /advanced/routes. gasless and destinationAction are rejected server-side. */
  options?: RouteOptions
}

export interface FundingOrderDestination {
  toChainId: number
  toTokenAddress: string
  toAddress: string
}

export interface FundingOrderOnramp {
  provider: string
  delivery: OnrampDelivery
  widgetUrl?: string
  fiatAmount: string
  fiatCurrency: string
  /** Present on the create response ONLY — a later GET omits it. Capture at create time. */
  estimatedFundingAmount?: string
}

export interface FundingOrderResult {
  fromTxHash?: string
  toTxHash?: string
  toAmount?: string
}

export interface FundingOrderLateDelivery {
  detectedAt: string
  providerStatus?: string
  txHash?: string
}

export interface FundingOrder {
  orderId: string
  partnerOrderId: string
  type: FundingOrderType
  status: FundingOrderStatus
  /** Open string — known values are documented server-side. Never narrow to a union. */
  substatus?: string
  destination: FundingOrderDestination
  /** A real LiFiStep. Absent for ONRAMP with DIRECT delivery. */
  quote?: LiFiStep
  /** Top-level source of truth for SMART_DEPOSIT and routed ONRAMP. */
  depositAddress?: string
  onramp?: FundingOrderOnramp
  result?: FundingOrderResult
  lateDelivery?: FundingOrderLateDelivery
  createdAt: string
  updatedAt: string
}

export interface GetFundingOrderParams {
  /** STANDARD, non-terminal orders only. Reports the source transaction. */
  txHash?: string
  /** Read-side counterpart of options.integrator for keyless partnerOrderId lookups. */
  integrator?: string
}

export interface WaitForFundingOrderOptions {
  /** Milliseconds between polls. Keep >= 10_000: each non-terminal read triggers a backend refresh. */
  pollingInterval?: number
  /** Milliseconds until the wait rejects with LiFiErrorCode.Timeout. The order stays PENDING. */
  timeout?: number
  /** Fires on every status/substatus transition, including the terminal one. */
  onUpdate?: (order: FundingOrder) => void
}
```

- [ ] **Step 2: Add the helper endpoint types to the same file**

These mirror `/Users/eugene/Projects/lifi-backend/apps/backend-api/src/services/checkout/transak/transak.types.ts` (shapes verified against the `funding-orders` branch):

```ts
export interface OnrampQuoteRequest {
  tokenAddress: string
  chainId: number
  fiatAmount: string
  fiatCurrency: string
  paymentMethod?: string
  countryCode?: string
}

export interface OnrampQuoteResult {
  provider: string
  fiat: {
    amount: string
    currency: string
  }
  funding: {
    tokenAddress: string
    chainId: number
    symbol: string
    network: string
    /** Non-binding estimate in human-readable units. The received amount may differ. */
    estimatedAmount: string
    decimals: number
  }
  paymentMethod?: string
  fees?: {
    currency: string
    total: { amount: string }
    breakdown?: Array<{ label: string; amount: string }>
  }
  warnings?: Array<{ code: string; message: string }>
}

export interface OnrampSessionRequest {
  depositAddress: string
  tokenAddress: string
  chainId: number
  fiatAmount: string
  fiatCurrency: string
  paymentMethod?: string
  countryCode?: string
}

export interface OnrampSessionResult {
  provider: string
  environment: 'staging' | 'production'
  fundingSessionId: string
  widgetUrl: string
}

export interface OnrampFiatCurrenciesRequest {
  tokenAddress: string
  chainId: number
  countryCode?: string
}

export interface OnrampPaymentOption {
  id: string
  name: string
  isActive: boolean
  minAmount: number
  maxAmount: number
  limitCurrency: string
  processingTime?: string
  defaultAmount?: number
  displayMessage?: string
  supportedCountryCode?: string[]
}

export interface OnrampFiatCurrency {
  symbol: string
  name: string
  isAllowed: boolean
  supportingCountries: string[]
  isPopular: boolean
  paymentOptions: OnrampPaymentOption[]
}

export interface OnrampFiatCurrenciesResult {
  cryptoCurrencyCode: string
  network: string
  defaultCurrency?: string
  fiatCurrencies: OnrampFiatCurrency[]
}

export interface CexSessionRequest {
  walletAddress: string
  tokenAddress: string
  chainId: number
  userId: string
}

export interface CexSessionResult {
  linkToken: string
}
```

- [ ] **Step 3: Export the types from the package root**

In `packages/sdk/src/index.ts`, after the `./types/execution.js` type export block, add:

```ts
export type {
  CexSessionRequest,
  CexSessionResult,
  CreateFundingOrderRequest,
  FundingOrder,
  FundingOrderDestination,
  FundingOrderLateDelivery,
  FundingOrderOnramp,
  FundingOrderResult,
  FundingOrderStatus,
  FundingOrderType,
  GetFundingOrderParams,
  OnrampDelivery,
  OnrampFiatCurrenciesRequest,
  OnrampFiatCurrenciesResult,
  OnrampFiatCurrency,
  OnrampPaymentOption,
  OnrampQuoteRequest,
  OnrampQuoteResult,
  OnrampSessionRequest,
  OnrampSessionResult,
  WaitForFundingOrderOptions,
} from './types/funding.js'
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @lifi/sdk check:types && pnpm check`
Expected: both pass (Biome sorts exports alphabetically — keep the order above).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/types/funding.ts packages/sdk/src/index.ts
git commit -m "feat(funding): add the funding order wire types"
```

---

### Task 2: HTTP error classification for 401 and 422

**Files:**
- Modify: `packages/sdk/src/errors/httpError.ts`
- Test: `packages/sdk/src/errors/httpError.unit.spec.ts` (create if absent; check first — if a spec exists, extend it)

**Interfaces:**
- Produces: `HTTPError` instances for 422 responses carry `code === LiFiErrorCode.TransactionConflict`; 401 carries `code === LiFiErrorCode.ValidationError`. `createFundingOrder` (Task 3) relies on this.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { LiFiErrorCode } from './constants.js'
import { HTTPError } from './httpError.js'

const makeResponse = (status: number, statusText: string): Response =>
  new Response(JSON.stringify({ message: 'x', code: 1000 }), {
    status,
    statusText,
  })

describe('HTTPError funding status classification', () => {
  it('classifies 422 as a conflict', () => {
    const error = new HTTPError(
      makeResponse(422, 'Unprocessable Entity'),
      'https://li.quest/v1/funding/orders',
      {}
    )
    expect(error.code).toBe(LiFiErrorCode.TransactionConflict)
  })

  it('classifies 401 as a validation error', () => {
    const error = new HTTPError(
      makeResponse(401, 'Unauthorized'),
      'https://li.quest/v1/funding/orders',
      {}
    )
    expect(error.code).toBe(LiFiErrorCode.ValidationError)
  })
})
```

- [ ] **Step 2: Run the test — expect failure**

Run: `pnpm --filter @lifi/sdk test httpError.unit.spec.ts`
Expected: FAIL — both cases currently fall through to `LiFiErrorCode.InternalError`.

- [ ] **Step 3: Add the two map entries**

In `statusCodeToErrorClassificationMap` (`httpError.ts:12`), add alongside the existing entries:

```ts
  [
    401,
    { type: ErrorName.ValidationError, code: LiFiErrorCode.ValidationError },
  ],
  [
    422,
    {
      type: ErrorName.ValidationError,
      code: LiFiErrorCode.TransactionConflict,
    },
  ],
```

- [ ] **Step 4: Run the test — expect pass; run the whole error suite**

Run: `pnpm --filter @lifi/sdk test errors`
Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/errors/httpError.ts packages/sdk/src/errors/httpError.unit.spec.ts
git commit -m "feat(funding): classify 401 and 422 responses"
```

---

### Task 3: `createFundingOrder` and `getFundingOrder` actions

**Files:**
- Create: `packages/sdk/src/actions/createFundingOrder.ts`
- Create: `packages/sdk/src/actions/getFundingOrder.ts`
- Create: `packages/sdk/src/actions/fundingOrders.unit.mock.ts`
- Modify: `packages/sdk/src/actions/actions.unit.handlers.ts`, `packages/sdk/src/actions/index.ts`, `packages/sdk/src/index.ts`
- Test: `packages/sdk/src/actions/createFundingOrder.unit.spec.ts`, `packages/sdk/src/actions/getFundingOrder.unit.spec.ts`

**Interfaces:**
- Consumes: `FundingOrder`, `CreateFundingOrderRequest`, `GetFundingOrderParams` (Task 1).
- Produces:
  - `createFundingOrder(client: SDKClient, params: CreateFundingOrderRequest, options?: RequestOptions): Promise<FundingOrder>`
  - `getFundingOrder(client: SDKClient, orderId: string, params?: GetFundingOrderParams, options?: RequestOptions): Promise<FundingOrder>`
  - `buildFundingOrder(overrides?: Partial<FundingOrder>): FundingOrder` (test fixture)

- [ ] **Step 1: Write the shared fixture**

Create `packages/sdk/src/actions/fundingOrders.unit.mock.ts`:

```ts
import type { FundingOrder } from '../types/funding.js'

export const buildFundingOrder = (
  overrides?: Partial<FundingOrder>
): FundingOrder => ({
  orderId: '3f2a6c1e-0000-4000-8000-000000000001',
  partnerOrderId: 'partner-order-1',
  type: 'STANDARD',
  status: 'PENDING',
  destination: {
    toChainId: 137,
    toTokenAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    toAddress: '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0',
  },
  createdAt: '2026-08-11T00:00:00.000Z',
  updatedAt: '2026-08-11T00:00:00.000Z',
  ...overrides,
})
```

- [ ] **Step 2: Add msw handlers**

In `packages/sdk/src/actions/actions.unit.handlers.ts`, import the fixture and append to `handlers`:

```ts
import { buildFundingOrder } from './fundingOrders.unit.mock.js'
```

```ts
  http.post(`${client.config.apiUrl}/funding/orders`, async () =>
    HttpResponse.json(buildFundingOrder(), { status: 201 })
  ),
  http.get(`${client.config.apiUrl}/funding/orders/:orderId`, async () =>
    HttpResponse.json(buildFundingOrder())
  ),
```

- [ ] **Step 3: Write the failing tests**

`packages/sdk/src/actions/createFundingOrder.unit.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import * as request from '../utils/request.js'
import { client, setupTestServer } from './actions.unit.handlers.js'
import { createFundingOrder } from './createFundingOrder.js'

const mockedFetch = vi.spyOn(request, 'request')

describe('createFundingOrder', () => {
  setupTestServer()

  const params = {
    partnerOrderId: 'partner-order-1',
    type: 'STANDARD' as const,
    toChainId: 137,
    toTokenAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    toAddress: '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0',
  }

  it('throws a ValidationError when partnerOrderId is empty', async () => {
    await expect(
      createFundingOrder(client, { ...params, partnerOrderId: '' })
    ).rejects.toThrowError(
      new SDKError(
        new ValidationError('Required parameter "partnerOrderId" is missing.')
      )
    )
    expect(mockedFetch).toHaveBeenCalledTimes(0)
  })

  it('posts the body and returns the order', async () => {
    const order = await createFundingOrder(client, params)
    expect(order.orderId).toBe('3f2a6c1e-0000-4000-8000-000000000001')
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })
})
```

`packages/sdk/src/actions/getFundingOrder.unit.spec.ts`:

```ts
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import * as request from '../utils/request.js'
import { client, setupTestServer } from './actions.unit.handlers.js'
import { buildFundingOrder } from './fundingOrders.unit.mock.js'
import { getFundingOrder } from './getFundingOrder.js'

const mockedFetch = vi.spyOn(request, 'request')

describe('getFundingOrder', () => {
  const server = setupTestServer()

  it('throws a ValidationError when orderId is empty', async () => {
    await expect(getFundingOrder(client, '')).rejects.toThrowError(
      new SDKError(new ValidationError('Required parameter "orderId" is missing.'))
    )
    expect(mockedFetch).toHaveBeenCalledTimes(0)
  })

  it('fetches the order by id', async () => {
    const order = await getFundingOrder(
      client,
      '3f2a6c1e-0000-4000-8000-000000000001'
    )
    expect(order.status).toBe('PENDING')
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })

  it('passes txHash and integrator as query parameters', async () => {
    let requestedUrl = ''
    server.use(
      http.get(
        `${client.config.apiUrl}/funding/orders/:orderId`,
        async ({ request: req }) => {
          requestedUrl = req.url
          return HttpResponse.json(buildFundingOrder())
        }
      )
    )
    await getFundingOrder(client, 'order-1', {
      txHash: '0xabc',
      integrator: 'jumper',
    })
    expect(requestedUrl).toContain('txHash=0xabc')
    expect(requestedUrl).toContain('integrator=jumper')
  })
})
```

- [ ] **Step 4: Run tests — expect failure**

Run: `pnpm --filter @lifi/sdk test FundingOrder.unit.spec.ts`
Expected: FAIL — modules do not exist.

- [ ] **Step 5: Implement both actions**

`packages/sdk/src/actions/createFundingOrder.ts`:

```ts
import type { RequestOptions } from '@lifi/types'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import type { SDKClient } from '../types/core.js'
import type {
  CreateFundingOrderRequest,
  FundingOrder,
} from '../types/funding.js'
import { request } from '../utils/request.js'

/**
 * Create a funding order. The response embeds the committed quote.
 * 200 (idempotent replay) and 201 (created) both resolve to the order.
 * @param client - The SDK client
 * @param params - The funding order creation request
 * @param options - Request options
 * @throws {SDKError} 422 wraps LiFiErrorCode.TransactionConflict (partnerOrderId reuse with a different body), 424 wraps ThirdPartyError (on-ramp provider outage), 401 wraps ValidationError (keyless ONRAMP).
 * @returns The created (or replayed) funding order.
 */
export const createFundingOrder = async (
  client: SDKClient,
  params: CreateFundingOrderRequest,
  options?: RequestOptions
): Promise<FundingOrder> => {
  if (!params.partnerOrderId) {
    throw new SDKError(
      new ValidationError('Required parameter "partnerOrderId" is missing.')
    )
  }
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
}
```

`packages/sdk/src/actions/getFundingOrder.ts`:

```ts
import type { RequestOptions } from '@lifi/types'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import type { SDKClient } from '../types/core.js'
import type { FundingOrder, GetFundingOrderParams } from '../types/funding.js'
import { request } from '../utils/request.js'

/**
 * Get a funding order by orderId (or partnerOrderId within the caller's scope).
 * Passing txHash reports the source transaction for a STANDARD, non-terminal order.
 * @param client - The SDK client
 * @param orderId - The orderId (UUID) or partnerOrderId
 * @param params - Optional txHash / integrator query parameters
 * @param options - Request options
 * @throws {SDKError} Throws if the request fails.
 * @returns The funding order.
 */
export const getFundingOrder = async (
  client: SDKClient,
  orderId: string,
  params?: GetFundingOrderParams,
  options?: RequestOptions
): Promise<FundingOrder> => {
  if (!orderId) {
    throw new SDKError(
      new ValidationError('Required parameter "orderId" is missing.')
    )
  }
  const queryParams = new URLSearchParams()
  if (params?.txHash) {
    queryParams.set('txHash', params.txHash)
  }
  if (params?.integrator) {
    queryParams.set('integrator', params.integrator)
  }
  const query = queryParams.size ? `?${queryParams}` : ''
  return await request<FundingOrder>(
    client.config,
    `${client.config.apiUrl}/funding/orders/${encodeURIComponent(orderId)}${query}`,
    {
      signal: options?.signal,
    }
  )
}
```

- [ ] **Step 6: Register and export**

In `packages/sdk/src/actions/index.ts`:
- imports: `import { createFundingOrder } from './createFundingOrder.js'` and `import { getFundingOrder } from './getFundingOrder.js'`; type imports `CreateFundingOrderRequest, FundingOrder, GetFundingOrderParams` from `../types/funding.js`.
- `Actions` type members (keep alphabetical placement):

```ts
  /**
   * Create a funding order
   * @param params - The funding order creation request
   * @param options - Request options
   * @returns The created funding order
   */
  createFundingOrder: (
    params: CreateFundingOrderRequest,
    options?: RequestOptions
  ) => Promise<FundingOrder>

  /**
   * Get a funding order by id
   * @param orderId - The orderId or partnerOrderId
   * @param params - Optional txHash / integrator query parameters
   * @param options - Request options
   * @returns The funding order
   */
  getFundingOrder: (
    orderId: string,
    params?: GetFundingOrderParams,
    options?: RequestOptions
  ) => Promise<FundingOrder>
```

- factory entries:

```ts
    createFundingOrder: (params, options) =>
      createFundingOrder(client, params, options),
    getFundingOrder: (orderId, params, options) =>
      getFundingOrder(client, orderId, params, options),
```

In `packages/sdk/src/index.ts`, with the other action exports (alphabetical):

```ts
export { createFundingOrder } from './actions/createFundingOrder.js'
export { getFundingOrder } from './actions/getFundingOrder.js'
```

- [ ] **Step 7: Run tests — expect pass**

Run: `pnpm --filter @lifi/sdk test:unit && pnpm --filter @lifi/sdk check:types`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/sdk/src/actions packages/sdk/src/index.ts
git commit -m "feat(funding): add createFundingOrder and getFundingOrder actions"
```

---

### Task 4: `waitForFundingOrder` polling action

**Files:**
- Create: `packages/sdk/src/actions/waitForFundingOrder.ts`
- Modify: `packages/sdk/src/actions/index.ts`, `packages/sdk/src/index.ts`
- Test: `packages/sdk/src/actions/waitForFundingOrder.unit.spec.ts`

**Interfaces:**
- Consumes: `getFundingOrder` (Task 3), `WaitForFundingOrderOptions` (Task 1), `sleep` from `../utils/sleep.js`.
- Produces: `waitForFundingOrder(client: SDKClient, orderId: string, options?: WaitForFundingOrderOptions): Promise<FundingOrder>` — resolves with the terminal order; rejects with `SDKError` wrapping `TransactionError(LiFiErrorCode.Timeout, …)` on timeout.

- [ ] **Step 1: Write the failing test**

```ts
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { LiFiErrorCode } from '../errors/constants.js'
import { client, setupTestServer } from './actions.unit.handlers.js'
import { buildFundingOrder } from './fundingOrders.unit.mock.js'
import { waitForFundingOrder } from './waitForFundingOrder.js'

describe('waitForFundingOrder', () => {
  const server = setupTestServer()

  it('polls until DONE and reports each transition once', async () => {
    let calls = 0
    server.use(
      http.get(`${client.config.apiUrl}/funding/orders/:orderId`, async () => {
        calls++
        if (calls === 1) {
          return HttpResponse.json(buildFundingOrder())
        }
        if (calls === 2) {
          return HttpResponse.json(
            buildFundingOrder({ substatus: 'WAIT_DESTINATION_TRANSACTION' })
          )
        }
        return HttpResponse.json(
          buildFundingOrder({ status: 'DONE', substatus: 'COMPLETED' })
        )
      })
    )
    const transitions: (string | undefined)[] = []
    const order = await waitForFundingOrder(client, 'order-1', {
      pollingInterval: 10,
      onUpdate: (o) => transitions.push(o.substatus),
    })
    expect(order.status).toBe('DONE')
    expect(transitions).toEqual([
      undefined,
      'WAIT_DESTINATION_TRANSACTION',
      'COMPLETED',
    ])
  })

  it('rejects with a Timeout code when the order stays PENDING', async () => {
    server.use(
      http.get(`${client.config.apiUrl}/funding/orders/:orderId`, async () =>
        HttpResponse.json(buildFundingOrder())
      )
    )
    await expect(
      waitForFundingOrder(client, 'order-1', {
        pollingInterval: 10,
        timeout: 35,
      })
    ).rejects.toMatchObject({ code: LiFiErrorCode.Timeout })
  })

  it('keeps polling through transient request failures', async () => {
    let calls = 0
    server.use(
      http.get(`${client.config.apiUrl}/funding/orders/:orderId`, async () => {
        calls++
        if (calls === 1) {
          return HttpResponse.json({ message: 'boom' }, { status: 500 })
        }
        return HttpResponse.json(buildFundingOrder({ status: 'DONE' }))
      })
    )
    const order = await waitForFundingOrder(client, 'order-1', {
      pollingInterval: 10,
    })
    expect(order.status).toBe('DONE')
  })
})
```

- [ ] **Step 2: Run the test — expect failure**

Run: `pnpm --filter @lifi/sdk test waitForFundingOrder`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```ts
import { LiFiErrorCode } from '../errors/constants.js'
import { TransactionError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import type { SDKClient } from '../types/core.js'
import type {
  FundingOrder,
  WaitForFundingOrderOptions,
} from '../types/funding.js'
import { sleep } from '../utils/sleep.js'
import { getFundingOrder } from './getFundingOrder.js'

/**
 * Poll a funding order until it reaches a terminal state (DONE or FAILED).
 * Non-terminal reads trigger a backend-side refresh — keep the interval >= 10s.
 * @param client - The SDK client
 * @param orderId - The orderId to poll
 * @param options - Polling interval, timeout, and transition callback
 * @throws {SDKError} Wraps TransactionError(LiFiErrorCode.Timeout) when the timeout elapses. The order stays PENDING and can be waited on again.
 * @returns The terminal funding order.
 */
export const waitForFundingOrder = async (
  client: SDKClient,
  orderId: string,
  options?: WaitForFundingOrderOptions
): Promise<FundingOrder> => {
  const pollingInterval = options?.pollingInterval ?? 10_000
  const timeout = options?.timeout ?? 1_200_000
  const deadline = Date.now() + timeout
  let previous: FundingOrder | undefined
  while (true) {
    const order = await getFundingOrder(client, orderId).catch(
      () => undefined
    )
    if (order) {
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
    await sleep(pollingInterval)
  }
}
```

- [ ] **Step 4: Register and export**

`actions/index.ts`: import; type import `WaitForFundingOrderOptions`; `Actions` member and factory entry:

```ts
  /**
   * Poll a funding order until it reaches a terminal state
   * @param orderId - The orderId to poll
   * @param options - Polling options
   * @returns The terminal funding order
   */
  waitForFundingOrder: (
    orderId: string,
    options?: WaitForFundingOrderOptions
  ) => Promise<FundingOrder>
```

```ts
    waitForFundingOrder: (orderId, options) =>
      waitForFundingOrder(client, orderId, options),
```

`src/index.ts`: `export { waitForFundingOrder } from './actions/waitForFundingOrder.js'`

- [ ] **Step 5: Run tests — expect pass**

Run: `pnpm --filter @lifi/sdk test waitForFundingOrder && pnpm --filter @lifi/sdk check:types`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/actions packages/sdk/src/index.ts
git commit -m "feat(funding): add the waitForFundingOrder polling action"
```

---

### Task 5: On-ramp and CEX helper actions

**Files:**
- Create: `packages/sdk/src/actions/getOnrampQuote.ts`, `getOnrampFiatCurrencies.ts`, `createOnrampSession.ts`, `createCexSession.ts`
- Modify: `packages/sdk/src/actions/actions.unit.handlers.ts`, `packages/sdk/src/actions/index.ts`, `packages/sdk/src/index.ts`
- Test: `packages/sdk/src/actions/fundingHelpers.unit.spec.ts`

**Interfaces:**
- Consumes: helper types (Task 1).
- Produces (all `(client, params, options?)`):
  - `getOnrampQuote(client: SDKClient, params: OnrampQuoteRequest, options?: RequestOptions): Promise<OnrampQuoteResult>` → `POST /funding/onramp/quote`
  - `getOnrampFiatCurrencies(client: SDKClient, params: OnrampFiatCurrenciesRequest, options?: RequestOptions): Promise<OnrampFiatCurrenciesResult>` → `POST /funding/onramp/fiat-currencies`
  - `createOnrampSession(client: SDKClient, params: OnrampSessionRequest, options?: RequestOptions): Promise<OnrampSessionResult>` → `POST /funding/onramp/session`
  - `createCexSession(client: SDKClient, params: CexSessionRequest, options?: RequestOptions): Promise<CexSessionResult>` → `POST /funding/cex/session`

All four are the same POST shape as `createFundingOrder` minus validation. Template (repeat per action, changing names, types, and path):

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest'
import * as request from '../utils/request.js'
import { client, setupTestServer } from './actions.unit.handlers.js'
import { createCexSession } from './createCexSession.js'
import { createOnrampSession } from './createOnrampSession.js'
import { getOnrampFiatCurrencies } from './getOnrampFiatCurrencies.js'
import { getOnrampQuote } from './getOnrampQuote.js'

const mockedFetch = vi.spyOn(request, 'request')

describe('funding helper actions', () => {
  setupTestServer()

  it('getOnrampQuote posts to /funding/onramp/quote', async () => {
    await getOnrampQuote(client, {
      tokenAddress: '0x0',
      chainId: 1,
      fiatAmount: '100',
      fiatCurrency: 'EUR',
    })
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })

  it('getOnrampFiatCurrencies posts to /funding/onramp/fiat-currencies', async () => {
    await getOnrampFiatCurrencies(client, { tokenAddress: '0x0', chainId: 1 })
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })

  it('createOnrampSession posts to /funding/onramp/session', async () => {
    await createOnrampSession(client, {
      depositAddress: '0x1',
      tokenAddress: '0x0',
      chainId: 1,
      fiatAmount: '100',
      fiatCurrency: 'EUR',
    })
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })

  it('createCexSession posts to /funding/cex/session', async () => {
    await createCexSession(client, {
      walletAddress: '0x2',
      tokenAddress: '0x0',
      chainId: 1,
      userId: 'user-1',
    })
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })
})
```

Add msw handlers in `actions.unit.handlers.ts`:

```ts
  http.post(`${client.config.apiUrl}/funding/onramp/quote`, async () =>
    HttpResponse.json({})
  ),
  http.post(
    `${client.config.apiUrl}/funding/onramp/fiat-currencies`,
    async () => HttpResponse.json({})
  ),
  http.post(`${client.config.apiUrl}/funding/onramp/session`, async () =>
    HttpResponse.json({})
  ),
  http.post(`${client.config.apiUrl}/funding/cex/session`, async () =>
    HttpResponse.json({})
  ),
```

- [ ] **Step 2: Run the test — expect failure** (modules missing)

Run: `pnpm --filter @lifi/sdk test fundingHelpers`

- [ ] **Step 3: Implement the four actions**

Each file follows this exact shape (shown for `getOnrampQuote`; repeat with the other three names/paths/types):

```ts
import type { RequestOptions } from '@lifi/types'
import type { SDKClient } from '../types/core.js'
import type {
  OnrampQuoteRequest,
  OnrampQuoteResult,
} from '../types/funding.js'
import { request } from '../utils/request.js'

/**
 * Get an on-ramp fiat quote for a token.
 * @param client - The SDK client
 * @param params - The on-ramp quote request
 * @param options - Request options
 * @throws {SDKError} Throws if the request fails.
 * @returns The on-ramp quote.
 */
export const getOnrampQuote = async (
  client: SDKClient,
  params: OnrampQuoteRequest,
  options?: RequestOptions
): Promise<OnrampQuoteResult> => {
  return await request<OnrampQuoteResult>(
    client.config,
    `${client.config.apiUrl}/funding/onramp/quote`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: options?.signal,
    }
  )
}
```

Paths: `funding/onramp/fiat-currencies` (`getOnrampFiatCurrencies`), `funding/onramp/session` (`createOnrampSession`), `funding/cex/session` (`createCexSession`).

- [ ] **Step 4: Register all four in `actions/index.ts` and export from `src/index.ts`** (same pattern as Task 3 Step 6 — `Actions` member + factory entry + root export, alphabetical)

- [ ] **Step 5: Run tests — expect pass**

Run: `pnpm --filter @lifi/sdk test:unit && pnpm --filter @lifi/sdk check:types`

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/actions packages/sdk/src/index.ts
git commit -m "feat(funding): add the on-ramp and CEX helper actions"
```

---

### Task 6: Funding step marker, `convertOrderToRoute`, and `getFundingOrderUpdatedStep`

**Files:**
- Modify: `packages/sdk/src/types/core.ts` (add `fundingOrderId` to `LiFiStepExtended`, line ~120)
- Create: `packages/sdk/src/utils/fundingOrderStep.ts`
- Create: `packages/sdk/src/utils/convertOrderToRoute.ts`
- Modify: `packages/sdk/src/index.ts`
- Test: `packages/sdk/src/utils/convertOrderToRoute.unit.spec.ts`, `packages/sdk/src/utils/fundingOrderStep.unit.spec.ts`

**Interfaces:**
- Consumes: `FundingOrder` (Task 1), `getFundingOrder` (Task 3), `convertQuoteToRoute` (existing).
- Produces:
  - `LiFiStepExtended.fundingOrderId?: string`
  - `isFundingOrderStep(step: LiFiStep | LiFiStepExtended): boolean`
  - `getFundingOrderUpdatedStep(client: SDKClient, step: LiFiStepExtended): Promise<LiFiStepExtended>` — re-fetches the order and restores the committed quote onto the step; throws `TransactionError(LiFiErrorCode.TransactionUnprepared)` if the order has no `quote.transactionRequest`.
  - `convertOrderToRoute(order: FundingOrder): Route` — synthetic route with `route.id === order.orderId` and the marker on the step.

- [ ] **Step 1: Add the marker field**

In `packages/sdk/src/types/core.ts`, extend:

```ts
export interface LiFiStepExtended extends LiFiStep {
  execution?: Execution
  /** Present when this step was derived from a funding order. Selects the funding execution branch. */
  fundingOrderId?: string
}
```

- [ ] **Step 2: Write the failing tests**

`packages/sdk/src/utils/convertOrderToRoute.unit.spec.ts`:

```ts
import type { LiFiStep } from '@lifi/types'
import { describe, expect, it } from 'vitest'
import type { LiFiStepExtended } from '../types/core.js'
import { buildFundingOrder } from '../actions/fundingOrders.unit.mock.js'
import { convertOrderToRoute } from './convertOrderToRoute.js'

const buildQuote = (): LiFiStep =>
  ({
    id: 'quote-step-1',
    type: 'lifi',
    tool: 'relay',
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
      approvalAddress: '0xApproval',
      executionDuration: 30,
    },
    transactionRequest: { to: '0xTo', data: '0xdata' },
    includedSteps: [],
  }) as unknown as LiFiStep

describe('convertOrderToRoute', () => {
  it('wraps the quote in a synthetic route keyed by orderId', () => {
    const order = buildFundingOrder({ quote: buildQuote() })
    const route = convertOrderToRoute(order)
    expect(route.id).toBe(order.orderId)
    expect(route.steps).toHaveLength(1)
    expect((route.steps[0] as LiFiStepExtended).fundingOrderId).toBe(
      order.orderId
    )
    expect(route.steps[0].transactionRequest).toBeDefined()
  })

  it('throws for a non-STANDARD order', () => {
    const order = buildFundingOrder({
      type: 'SMART_DEPOSIT',
      quote: buildQuote(),
    })
    expect(() => convertOrderToRoute(order)).toThrowError(
      /Only STANDARD funding orders/
    )
  })

  it('throws when the order has no quote', () => {
    const order = buildFundingOrder()
    expect(() => convertOrderToRoute(order)).toThrowError(/has no quote/)
  })
})
```

`packages/sdk/src/utils/fundingOrderStep.unit.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('../actions/getFundingOrder.js', () => ({
  getFundingOrder: vi.fn(),
}))

import { getFundingOrder } from '../actions/getFundingOrder.js'
import { buildFundingOrder } from '../actions/fundingOrders.unit.mock.js'
import { LiFiErrorCode } from '../errors/constants.js'
import type { LiFiStepExtended } from '../types/core.js'
import {
  getFundingOrderUpdatedStep,
  isFundingOrderStep,
} from './fundingOrderStep.js'

const step = {
  id: 'step-1',
  fundingOrderId: 'order-1',
  execution: { status: 'PENDING', actions: [] },
} as unknown as LiFiStepExtended

describe('isFundingOrderStep', () => {
  it('is true only when fundingOrderId is a non-empty string', () => {
    expect(isFundingOrderStep(step)).toBe(true)
    expect(isFundingOrderStep({ id: 'x' } as LiFiStepExtended)).toBe(false)
  })
})

describe('getFundingOrderUpdatedStep', () => {
  it('restores the committed quote onto the step, keeping id, marker, and execution', async () => {
    const quote = {
      id: 'server-quote-id',
      transactionRequest: { to: '0xTo', data: '0xdata' },
    }
    vi.mocked(getFundingOrder).mockResolvedValue(
      buildFundingOrder({ quote: quote as any })
    )
    const updated = await getFundingOrderUpdatedStep({} as any, step)
    expect(updated.id).toBe('step-1')
    expect(updated.fundingOrderId).toBe('order-1')
    expect(updated.execution).toBe(step.execution)
    expect(updated.transactionRequest).toEqual({ to: '0xTo', data: '0xdata' })
  })

  it('throws TransactionUnprepared when the order quote has no transactionRequest', async () => {
    vi.mocked(getFundingOrder).mockResolvedValue(buildFundingOrder())
    await expect(
      getFundingOrderUpdatedStep({} as any, step)
    ).rejects.toMatchObject({ code: LiFiErrorCode.TransactionUnprepared })
  })
})
```

- [ ] **Step 3: Run tests — expect failure** (modules missing)

Run: `pnpm --filter @lifi/sdk test convertOrderToRoute fundingOrderStep`

- [ ] **Step 4: Implement**

`packages/sdk/src/utils/fundingOrderStep.ts`:

```ts
import type { LiFiStep } from '@lifi/types'
import { getFundingOrder } from '../actions/getFundingOrder.js'
import { LiFiErrorCode } from '../errors/constants.js'
import { TransactionError } from '../errors/errors.js'
import type { LiFiStepExtended, SDKClient } from '../types/core.js'

/**
 * Whether a step was derived from a funding order and must use the funding
 * execution branch (committed quote, order-endpoint status).
 */
export function isFundingOrderStep(
  step: LiFiStep | LiFiStepExtended
): boolean {
  const id = (step as LiFiStepExtended).fundingOrderId
  return typeof id === 'string' && id.length > 0
}

/**
 * Restore the committed quote of a funding order onto a step.
 * Funding orders have no re-quote endpoint — the order itself stores the
 * committed quote, so a refresh is a plain order read.
 * @throws {TransactionError} TransactionUnprepared when the order has no executable quote.
 */
export async function getFundingOrderUpdatedStep(
  client: SDKClient,
  step: LiFiStepExtended
): Promise<LiFiStepExtended> {
  const order = await getFundingOrder(client, step.fundingOrderId!)
  if (!order.quote?.transactionRequest) {
    throw new TransactionError(
      LiFiErrorCode.TransactionUnprepared,
      'Unable to prepare transaction. The funding order quote has no transaction request.'
    )
  }
  return {
    ...order.quote,
    id: step.id,
    fundingOrderId: step.fundingOrderId,
    execution: step.execution,
  }
}
```

`packages/sdk/src/utils/convertOrderToRoute.ts`:

```ts
import type { Route } from '@lifi/types'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import type { LiFiStepExtended } from '../types/core.js'
import type { FundingOrder } from '../types/funding.js'
import { convertQuoteToRoute } from './convertQuoteToRoute.js'

/**
 * Converts a STANDARD funding order into a synthetic route for executeRoute.
 * The route id is the orderId, so execution state and UI map one-to-one.
 * @param order - The funding order holding a committed quote.
 * @returns The route to be executed.
 * @throws {SDKError} ValidationError for non-STANDARD orders or a missing quote.
 */
export const convertOrderToRoute = (order: FundingOrder): Route => {
  if (order.type !== 'STANDARD') {
    throw new SDKError(
      new ValidationError(
        `Only STANDARD funding orders are executable. Order ${order.orderId} is ${order.type}.`
      )
    )
  }
  if (!order.quote) {
    throw new SDKError(
      new ValidationError(`Funding order ${order.orderId} has no quote.`)
    )
  }
  const route = convertQuoteToRoute(order.quote)
  route.id = order.orderId
  const step = route.steps[0] as LiFiStepExtended
  step.fundingOrderId = order.orderId
  return route
}
```

- [ ] **Step 5: Export from `src/index.ts`**

```ts
export { convertOrderToRoute } from './utils/convertOrderToRoute.js'
export {
  getFundingOrderUpdatedStep,
  isFundingOrderStep,
} from './utils/fundingOrderStep.js'
```

- [ ] **Step 6: Run tests — expect pass**

Run: `pnpm --filter @lifi/sdk test:unit && pnpm --filter @lifi/sdk check:types`

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/types/core.ts packages/sdk/src/utils packages/sdk/src/index.ts
git commit -m "feat(funding): add the order-to-route adapter and funding step predicate"
```

---

### Task 7: Funding branch in `PrepareTransactionTask`

**Files:**
- Modify: `packages/sdk/src/core/tasks/PrepareTransactionTask.ts`
- Test: `packages/sdk/src/core/tasks/PrepareTransactionTask.unit.spec.ts` (create if absent; extend if present)

**Interfaces:**
- Consumes: `isFundingOrderStep`, `getFundingOrderUpdatedStep` (Task 6).
- Produces: for funding steps, `PrepareTransactionTask` never calls `getStepTransaction` and never runs `stepComparison`; a missing `transactionRequest` is restored via `getFundingOrderUpdatedStep`.

- [ ] **Step 1: Write the failing test**

```ts
import type { LiFiStep } from '@lifi/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../actions/getStepTransaction.js', () => ({
  getStepTransaction: vi.fn(),
}))
vi.mock('../../utils/fundingOrderStep.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getFundingOrderUpdatedStep: vi.fn(),
}))

import { getStepTransaction } from '../../actions/getStepTransaction.js'
import type { LiFiStepExtended } from '../../types/core.js'
import type { StepExecutorContext } from '../../types/execution.js'
import { getFundingOrderUpdatedStep } from '../../utils/fundingOrderStep.js'
import { PrepareTransactionTask } from './PrepareTransactionTask.js'

const buildContext = (step: LiFiStepExtended): StepExecutorContext =>
  ({
    client: {} as any,
    step,
    statusManager: {
      findAction: vi.fn(() => ({ type: 'SWAP' })),
      updateAction: vi.fn(),
    } as any,
    isBridgeExecution: false,
    allowUserInteraction: true,
  }) as unknown as StepExecutorContext

const buildFundingStep = (
  overrides?: Partial<LiFiStepExtended>
): LiFiStepExtended =>
  ({
    id: 'step-1',
    fundingOrderId: 'order-1',
    action: { fromChainId: 1, toChainId: 137 },
    ...overrides,
  }) as unknown as LiFiStepExtended

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PrepareTransactionTask — funding branch', () => {
  it('uses the stored transactionRequest without calling getStepTransaction', async () => {
    const step = buildFundingStep({
      transactionRequest: { to: '0xTo', data: '0xdata' },
    } as Partial<LiFiStepExtended>)
    const result = await new PrepareTransactionTask().run(buildContext(step))
    expect(result.status).toBe('COMPLETED')
    expect(vi.mocked(getStepTransaction)).not.toHaveBeenCalled()
    expect(vi.mocked(getFundingOrderUpdatedStep)).not.toHaveBeenCalled()
  })

  it('restores a missing transactionRequest from the order, not from getStepTransaction', async () => {
    const step = buildFundingStep()
    vi.mocked(getFundingOrderUpdatedStep).mockResolvedValue(
      buildFundingStep({
        transactionRequest: { to: '0xTo', data: '0xdata' },
      } as Partial<LiFiStepExtended>)
    )
    const result = await new PrepareTransactionTask().run(buildContext(step))
    expect(result.status).toBe('COMPLETED')
    expect(vi.mocked(getFundingOrderUpdatedStep)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(getStepTransaction)).not.toHaveBeenCalled()
    expect(step.transactionRequest).toEqual({ to: '0xTo', data: '0xdata' })
  })
})
```

Note for the implementer: if creating this spec file fresh, also port a minimal regression test for the standard path (step without `fundingOrderId` and without `transactionRequest` calls `getStepTransaction` once — mock it to return a step with `transactionRequest: { data: '0x' }` and mock `./helpers/stepComparison.js` to pass the step through).

- [ ] **Step 2: Run the test — expect failure**

Run: `pnpm --filter @lifi/sdk test PrepareTransactionTask`
Expected: FAIL — the funding step with a missing `transactionRequest` currently goes to `getStepTransaction`.

- [ ] **Step 3: Implement the branch**

In `PrepareTransactionTask.run`, replace the block `if (!step.transactionRequest) { … }` with:

```ts
    if (!step.transactionRequest) {
      if (isFundingOrderStep(step)) {
        // Funding orders have no re-quote endpoint - restore the committed
        // quote from the order itself and skip the rate-change comparison.
        const updatedStep = await getFundingOrderUpdatedStep(client, step)
        Object.assign(step, updatedStep)
      } else {
        const { execution, ...stepBase } = step
        const updatedStep = await getStepTransaction(client, stepBase)
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
        })
      }
    }
```

Add the import:

```ts
import {
  getFundingOrderUpdatedStep,
  isFundingOrderStep,
} from '../../utils/fundingOrderStep.js'
```

- [ ] **Step 4: Run tests — expect pass, no regressions**

Run: `pnpm --filter @lifi/sdk test:unit`

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/tasks/PrepareTransactionTask.ts packages/sdk/src/core/tasks/PrepareTransactionTask.unit.spec.ts
git commit -m "feat(funding): prepare funding steps from the committed order quote"
```

---

### Task 8: `WaitForFundingOrderTask` and the wait-slot delegation

**Files:**
- Create: `packages/sdk/src/core/tasks/WaitForFundingOrderTask.ts`
- Modify: `packages/sdk/src/core/tasks/WaitForTransactionStatusTask.ts`
- Modify: `packages/sdk/src/index.ts` (export the new task)
- Test: `packages/sdk/src/core/tasks/WaitForFundingOrderTask.unit.spec.ts`

**Interfaces:**
- Consumes: `getFundingOrder`, `waitForFundingOrder` (Tasks 3–4), `isFundingOrderStep` (Task 6), `getActionMessage`/`getSubstatusMessage` conventions via `StatusManager`.
- Produces:
  - `class WaitForFundingOrderTask extends BaseStepExecutionTask` with `constructor(actionType: ExecutionActionType)` and `run(context: StepExecutorContext): Promise<TaskResult>`.
  - `WaitForTransactionStatusTask.run` delegates to it for funding steps — providers stay untouched.
  - `FundingExecutionOptions` consumers: the task calls `(context.executionOptions as FundingExecutionOptions).onOrderUpdate?.(order)` on transitions (type defined in Task 9; the task reads it via an optional-chained cast, so Task 8 compiles standalone).

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../actions/getFundingOrder.js', () => ({
  getFundingOrder: vi.fn(),
}))
vi.mock('../../actions/waitForFundingOrder.js', () => ({
  waitForFundingOrder: vi.fn(),
}))

import { getFundingOrder } from '../../actions/getFundingOrder.js'
import { buildFundingOrder } from '../../actions/fundingOrders.unit.mock.js'
import { waitForFundingOrder } from '../../actions/waitForFundingOrder.js'
import { LiFiErrorCode } from '../../errors/constants.js'
import type { LiFiStepExtended } from '../../types/core.js'
import type { StepExecutorContext } from '../../types/execution.js'
import { WaitForFundingOrderTask } from './WaitForFundingOrderTask.js'

const buildStep = (): LiFiStepExtended =>
  ({
    id: 'step-1',
    fundingOrderId: 'order-1',
    action: { fromChainId: 1, toChainId: 137 },
  }) as unknown as LiFiStepExtended

const buildContext = (step: LiFiStepExtended): StepExecutorContext => {
  const action = { type: 'SWAP', txHash: '0xsource' }
  return {
    client: {} as any,
    step,
    statusManager: {
      findAction: vi.fn(() => action),
      initializeAction: vi.fn(() => ({ type: 'RECEIVING_CHAIN' })),
      updateAction: vi.fn(),
      updateExecution: vi.fn(),
    } as any,
    isBridgeExecution: false,
    toChain: { id: 137, metamask: { blockExplorerUrls: ['https://x/'] } },
  } as unknown as StepExecutorContext
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('WaitForFundingOrderTask', () => {
  it('reports the txHash, polls to DONE, and marks the execution DONE with the order result', async () => {
    vi.mocked(getFundingOrder).mockResolvedValue(buildFundingOrder())
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({
        status: 'DONE',
        substatus: 'COMPLETED',
        result: { toTxHash: '0xdest', toAmount: '990000' },
      })
    )
    const step = buildStep()
    const context = buildContext(step)

    const result = await new WaitForFundingOrderTask('RECEIVING_CHAIN').run(
      context
    )

    expect(result.status).toBe('COMPLETED')
    expect(vi.mocked(getFundingOrder)).toHaveBeenCalledWith(
      context.client,
      'order-1',
      { txHash: '0xsource' }
    )
    expect(context.statusManager.updateExecution).toHaveBeenCalledWith(
      step,
      expect.objectContaining({ status: 'DONE', toAmount: '990000' })
    )
  })

  it('throws TransactionFailed when the order ends FAILED', async () => {
    vi.mocked(getFundingOrder).mockResolvedValue(buildFundingOrder())
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'FAILED', substatus: 'ONRAMP_FAILED' })
    )
    await expect(
      new WaitForFundingOrderTask('RECEIVING_CHAIN').run(
        buildContext(buildStep())
      )
    ).rejects.toMatchObject({ code: LiFiErrorCode.TransactionFailed })
  })

  it('still polls when reporting the txHash fails', async () => {
    vi.mocked(getFundingOrder).mockRejectedValue(new Error('report failed'))
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    const result = await new WaitForFundingOrderTask('RECEIVING_CHAIN').run(
      buildContext(buildStep())
    )
    expect(result.status).toBe('COMPLETED')
  })
})
```

- [ ] **Step 2: Run the test — expect failure** (module missing)

Run: `pnpm --filter @lifi/sdk test WaitForFundingOrderTask`

- [ ] **Step 3: Implement the task**

Create `packages/sdk/src/core/tasks/WaitForFundingOrderTask.ts`:

```ts
import { getFundingOrder } from '../../actions/getFundingOrder.js'
import { waitForFundingOrder } from '../../actions/waitForFundingOrder.js'
import { LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError } from '../../errors/errors.js'
import type { ExecutionActionType } from '../../types/core.js'
import type { FundingOrder } from '../../types/funding.js'
import type { StepExecutorContext, TaskResult } from '../../types/execution.js'
import { BaseStepExecutionTask } from '../BaseStepExecutionTask.js'

/**
 * Wait slot for funding-order steps. Reports the source txHash to the order
 * endpoint, then polls the order (not /status) to a terminal state.
 */
export class WaitForFundingOrderTask extends BaseStepExecutionTask {
  readonly actionType: ExecutionActionType

  constructor(actionType: ExecutionActionType) {
    super()
    this.actionType = actionType
  }

  async run(context: StepExecutorContext): Promise<TaskResult> {
    const { client, step, statusManager, isBridgeExecution } = context
    const orderId = step.fundingOrderId!

    const sourceAction = statusManager.findAction(
      step,
      isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )
    const txHash = sourceAction?.txHash

    const action = statusManager.initializeAction({
      step,
      type: this.actionType,
      chainId:
        this.actionType === 'RECEIVING_CHAIN'
          ? step.action.toChainId
          : step.action.fromChainId,
      status: 'PENDING',
    })

    // Report the source transaction. Non-fatal: the backend can also find
    // it through its own indexers, so a failed report must not stop polling.
    if (txHash) {
      await getFundingOrder(client, orderId, { txHash }).catch(() => undefined)
    }

    const onOrderUpdate = (
      context.executionOptions as
        | { onOrderUpdate?: (order: FundingOrder) => void }
        | undefined
    )?.onOrderUpdate

    const order = await waitForFundingOrder(client, orderId, {
      onUpdate: (updatedOrder) => {
        onOrderUpdate?.(updatedOrder)
        if (updatedOrder.status === 'PENDING') {
          statusManager.updateAction(step, action.type, 'PENDING', {
            substatus: updatedOrder.substatus as any,
          })
        }
      },
      pollingInterval: context.pollingIntervalMs,
    })

    if (order.status === 'FAILED') {
      throw new TransactionError(
        LiFiErrorCode.TransactionFailed,
        `Funding order ${orderId} failed${order.substatus ? ` (${order.substatus})` : ''}.`
      )
    }

    statusManager.updateAction(step, action.type, 'DONE', {
      chainId: step.action.toChainId,
      txHash: order.result?.toTxHash,
    })

    statusManager.updateExecution(step, {
      status: 'DONE',
      ...(order.result?.toAmount && { toAmount: order.result.toAmount }),
    })

    return { status: 'COMPLETED' }
  }
}
```

Note: `substatus as any` — the `/status` substatus vocabulary flows through the funding `substatus` open string; `ExecutionAction.substatus` is typed as the `@lifi/types` `Substatus` union. The cast is deliberate and documented by this plan; do not widen the core type.

- [ ] **Step 4: Delegate from `WaitForTransactionStatusTask`**

At the top of `WaitForTransactionStatusTask.run` (before the existing try block), add:

```ts
    if (isFundingOrderStep(context.step)) {
      return new WaitForFundingOrderTask(this.actionType).run(context)
    }
```

with imports:

```ts
import { isFundingOrderStep } from '../../utils/fundingOrderStep.js'
import { WaitForFundingOrderTask } from './WaitForFundingOrderTask.js'
```

Add a delegation test to the spec file:

```ts
import { WaitForTransactionStatusTask } from './WaitForTransactionStatusTask.js'

describe('WaitForTransactionStatusTask — funding delegation', () => {
  it('routes funding steps to WaitForFundingOrderTask', async () => {
    vi.mocked(getFundingOrder).mockResolvedValue(buildFundingOrder())
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

- [ ] **Step 5: Export the task from `src/index.ts`**

```ts
export { WaitForFundingOrderTask } from './core/tasks/WaitForFundingOrderTask.js'
```

- [ ] **Step 6: Run tests — expect pass**

Run: `pnpm --filter @lifi/sdk test:unit && pnpm --filter @lifi/sdk check:types`

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/core/tasks packages/sdk/src/index.ts
git commit -m "feat(funding): add the funding order wait task and wait-slot delegation"
```

---

### Task 9: `executeFundingOrder` and `resumeFundingOrder`

**Files:**
- Create: `packages/sdk/src/core/fundingExecution.ts`
- Modify: `packages/sdk/src/index.ts`
- Test: `packages/sdk/src/core/fundingExecution.unit.spec.ts`

**Interfaces:**
- Consumes: `executeRoute`, `resumeRoute` (existing), `convertOrderToRoute` (Task 6), `getFundingOrder`, `waitForFundingOrder` (Tasks 3–4).
- Produces:
  - `interface FundingExecutionOptions extends ExecutionOptions { onOrderUpdate?: (order: FundingOrder) => void; pollingInterval?: number; timeout?: number }`
  - `executeFundingOrder(client: SDKClient, order: FundingOrder, options?: FundingExecutionOptions): Promise<FundingOrder>`
  - `resumeFundingOrder(client: SDKClient, order: FundingOrder, options?: FundingExecutionOptions): Promise<FundingOrder>`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./execution.js', () => ({
  executeRoute: vi.fn(),
  resumeRoute: vi.fn(),
}))
vi.mock('../actions/getFundingOrder.js', () => ({
  getFundingOrder: vi.fn(),
}))
vi.mock('../actions/waitForFundingOrder.js', () => ({
  waitForFundingOrder: vi.fn(),
}))

import { getFundingOrder } from '../actions/getFundingOrder.js'
import { buildFundingOrder } from '../actions/fundingOrders.unit.mock.js'
import { waitForFundingOrder } from '../actions/waitForFundingOrder.js'
import { executeRoute, resumeRoute } from './execution.js'
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('executeFundingOrder', () => {
  it('rejects a FAILED order', async () => {
    await expect(
      executeFundingOrder({} as any, buildFundingOrder({ status: 'FAILED' }))
    ).rejects.toThrowError(/new order/)
  })

  it('returns a DONE order as-is without executing', async () => {
    const done = buildFundingOrder({ status: 'DONE' })
    await expect(executeFundingOrder({} as any, done)).resolves.toBe(done)
    expect(vi.mocked(executeRoute)).not.toHaveBeenCalled()
  })

  it('executes a STANDARD order through executeRoute and returns the final order', async () => {
    const order = buildFundingOrder({ quote })
    vi.mocked(executeRoute).mockResolvedValue({} as any)
    vi.mocked(getFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    const final = await executeFundingOrder({} as any, order)
    expect(vi.mocked(executeRoute)).toHaveBeenCalledTimes(1)
    const [, route] = vi.mocked(executeRoute).mock.calls[0]
    expect(route.id).toBe(order.orderId)
    expect(final.status).toBe('DONE')
  })

  it('only polls for SMART_DEPOSIT orders', async () => {
    const order = buildFundingOrder({ type: 'SMART_DEPOSIT' })
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    const final = await executeFundingOrder({} as any, order)
    expect(final.status).toBe('DONE')
    expect(vi.mocked(executeRoute)).not.toHaveBeenCalled()
  })
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

  it('skips the pipeline and polls when the source transaction was already sent', async () => {
    vi.mocked(getFundingOrder).mockResolvedValue(
      buildFundingOrder({ quote, result: { fromTxHash: '0xsent' } })
    )
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    const final = await resumeFundingOrder({} as any, buildFundingOrder())
    expect(final.status).toBe('DONE')
    expect(vi.mocked(resumeRoute)).not.toHaveBeenCalled()
  })

  it('resumes the route pipeline when nothing was sent yet', async () => {
    vi.mocked(getFundingOrder)
      .mockResolvedValueOnce(buildFundingOrder({ quote }))
      .mockResolvedValueOnce(buildFundingOrder({ status: 'DONE' }))
    vi.mocked(resumeRoute).mockResolvedValue({} as any)
    const final = await resumeFundingOrder({} as any, buildFundingOrder())
    expect(vi.mocked(resumeRoute)).toHaveBeenCalledTimes(1)
    expect(final.status).toBe('DONE')
  })
})
```

- [ ] **Step 2: Run the test — expect failure** (module missing)

Run: `pnpm --filter @lifi/sdk test fundingExecution`

- [ ] **Step 3: Implement**

Create `packages/sdk/src/core/fundingExecution.ts`:

```ts
import { getFundingOrder } from '../actions/getFundingOrder.js'
import { waitForFundingOrder } from '../actions/waitForFundingOrder.js'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import type { ExecutionOptions, SDKClient } from '../types/core.js'
import type { FundingOrder } from '../types/funding.js'
import { convertOrderToRoute } from '../utils/convertOrderToRoute.js'
import { executeRoute, resumeRoute } from './execution.js'

export interface FundingExecutionOptions extends ExecutionOptions {
  /** Fires on every order status/substatus transition for every order type. */
  onOrderUpdate?: (order: FundingOrder) => void
  /** Poll interval for the order endpoint. Default 10_000. */
  pollingInterval?: number
  /** Timeout for reaching a terminal order state. Default 1_200_000 (20 min). */
  timeout?: number
}

const waitOnly = async (
  client: SDKClient,
  order: FundingOrder,
  options?: FundingExecutionOptions
): Promise<FundingOrder> => {
  return waitForFundingOrder(client, order.orderId, {
    pollingInterval: options?.pollingInterval,
    timeout: options?.timeout,
    onUpdate: options?.onOrderUpdate,
  })
}

/**
 * Execute a funding order. STANDARD orders run through the standard route
 * execution pipeline (allowance, sign, send) and then track the order to a
 * terminal state. SMART_DEPOSIT and ONRAMP orders only poll - rendering the
 * deposit QR or the on-ramp widget is the caller's job.
 * @param client - The SDK client.
 * @param order - The funding order to execute. Must not be FAILED.
 * @param options - Execution options, including route execution hooks for STANDARD orders.
 * @throws {SDKError} ValidationError for a FAILED order - create a new order instead.
 * @returns The terminal funding order.
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
  const route = convertOrderToRoute(order)
  await executeRoute(client, route, options)
  return getFundingOrder(client, order.orderId)
}

/**
 * Resume a funding order. Re-fetches the order first: terminal orders return
 * immediately; orders whose source transaction was already sent skip straight
 * to polling; otherwise the STANDARD route pipeline resumes.
 * @param client - The SDK client.
 * @param order - The funding order to resume.
 * @param options - Execution options.
 * @returns The terminal funding order.
 */
export const resumeFundingOrder = async (
  client: SDKClient,
  order: FundingOrder,
  options?: FundingExecutionOptions
): Promise<FundingOrder> => {
  const fresh = await getFundingOrder(client, order.orderId)
  if (fresh.status === 'DONE' || fresh.status === 'FAILED') {
    return fresh
  }
  if (fresh.type !== 'STANDARD' || fresh.result?.fromTxHash) {
    return waitOnly(client, fresh, options)
  }
  const route = convertOrderToRoute(fresh)
  await resumeRoute(client, route, options)
  return getFundingOrder(client, fresh.orderId)
}
```

- [ ] **Step 4: Export from `src/index.ts`**

```ts
export {
  executeFundingOrder,
  type FundingExecutionOptions,
  resumeFundingOrder,
} from './core/fundingExecution.js'
```

- [ ] **Step 5: Run tests — expect pass**

Run: `pnpm --filter @lifi/sdk test:unit && pnpm --filter @lifi/sdk check:types`

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/core/fundingExecution.ts packages/sdk/src/core/fundingExecution.unit.spec.ts packages/sdk/src/index.ts
git commit -m "feat(funding): add executeFundingOrder and resumeFundingOrder"
```

---

### Task 10: Ethereum provider funding branch, changeset, full verification

**Files:**
- Modify: `packages/sdk-provider-ethereum/src/core/tasks/helpers/getUpdatedStep.ts`
- Test: `packages/sdk-provider-ethereum/src/core/tasks/helpers/getUpdatedStep.unit.spec.ts` (create if absent; extend if present)
- Create: `.changeset/funding-orders-surface.md`

**Interfaces:**
- Consumes: `isFundingOrderStep`, `getFundingOrderUpdatedStep` re-exported from `@lifi/sdk` (Task 6).
- Produces: funding steps in the Ethereum retry/refresh path never hit `/advanced/stepTransaction`, `/relayer/quote`, or the contract-calls flow.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@lifi/sdk', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getFundingOrderUpdatedStep: vi.fn(),
  getStepTransaction: vi.fn(),
}))

import {
  getFundingOrderUpdatedStep,
  getStepTransaction,
  type LiFiStepExtended,
} from '@lifi/sdk'
import { getUpdatedStep } from './getUpdatedStep.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getUpdatedStep — funding branch', () => {
  it('refreshes funding steps from the order, never from stepTransaction', async () => {
    const step = {
      id: 'step-1',
      fundingOrderId: 'order-1',
      includedSteps: [],
    } as unknown as LiFiStepExtended
    vi.mocked(getFundingOrderUpdatedStep).mockResolvedValue(step)

    await getUpdatedStep({} as any, step)

    expect(vi.mocked(getFundingOrderUpdatedStep)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(getStepTransaction)).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test — expect failure**

Run: `pnpm --filter @lifi/sdk-provider-ethereum test getUpdatedStep`
Expected: FAIL — the funding step currently falls through to `getStandardUpdatedStep`.

- [ ] **Step 3: Implement the branch**

In `getUpdatedStep.ts`, add `getFundingOrderUpdatedStep` and `isFundingOrderStep` to the existing `@lifi/sdk` import, then make the funding check the FIRST branch:

```ts
export const getUpdatedStep = async (
  client: SDKClient,
  step: LiFiStepExtended,
  executionOptions?: ExecutionOptions,
  signedTypedData?: SignedTypedData[]
): Promise<LiFiStepExtended> => {
  if (isFundingOrderStep(step)) {
    return getFundingOrderUpdatedStep(client, step)
  }
  if (isContractCallStep(step)) {
    return getContractCallUpdatedStep(client, step, executionOptions)
  }
  if (isRelayerStep(step) && isGaslessStep(step)) {
    return getRelayerUpdatedStep(client, step)
  }
  return getStandardUpdatedStep(client, step, signedTypedData)
}
```

- [ ] **Step 4: Run the provider suite — expect pass**

Run: `pnpm --filter @lifi/sdk-provider-ethereum test:unit && pnpm check:types`

- [ ] **Step 5: Write the changeset**

Create `.changeset/funding-orders-surface.md`:

```md
---
'@lifi/sdk': minor
'@lifi/sdk-provider-ethereum': minor
---

Add the unified funding orders surface: funding order types, `createFundingOrder`, `getFundingOrder`, `waitForFundingOrder`, the on-ramp/CEX helper actions, and `executeFundingOrder`/`resumeFundingOrder`, which run STANDARD orders through the existing route execution pipeline via `convertOrderToRoute`. Funding steps restore their committed quote from the order and track status against the order endpoint.
```

- [ ] **Step 6: Full verification**

Run: `pnpm check && pnpm check:types && pnpm test:unit && pnpm build`
Expected: all pass across the workspace.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk-provider-ethereum .changeset/funding-orders-surface.md
git commit -m "feat(funding): route ethereum step refresh through the funding order"
```

---

## Live verification (after all tasks)

Not a checkbox task — an operator step with the user, per spec §8:

1. Run `lifi-backend` (branch `funding-orders`) locally.
2. Point a small node script (pattern: `examples/node/examples/`) at it via `createClient({ apiUrl: 'http://localhost:3000/v1', integrator: 'sdk-funding-test' })`.
3. Create a STANDARD order on a test chain, run `executeFundingOrder`, confirm the order reaches `DONE` and the txHash report lands (backend logs).
4. Create a SMART_DEPOSIT order, fund the deposit address from another wallet, confirm `waitForFundingOrder` resolves.
