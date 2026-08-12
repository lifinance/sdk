import type { LiFiStep, RouteOptions } from '@lifi/types'
import type { ExecutionOptions } from './core.js'

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
