import type {
  Action,
  GetStatusRequest,
  LiFiStep,
  QuoteRequest as QuoteRequestBase,
  RoutesRequest as RoutesRequestBase,
  SignedLiFiStep,
} from '@lifi/types'

export type GetStatusRequestExtended = GetStatusRequest & {
  fromAddress?: string
}

/**
 * Optional limit-order fields. Supplying them opts a request into limit-order
 * handling; resolution happens on the backend.
 */
type OrderFields = {
  toAmount?: string
  validUntil?: number
  partiallyFillable?: boolean
}

export type RoutesRequest = Omit<RoutesRequestBase, 'options'> &
  OrderFields & {
    options?: RoutesRequestBase['options'] & {
      /** (default: false) Whether to request private routes */
      private?: boolean
    }
  }

/**
 * A step request that may carry the optional limit-order `action` fields.
 */
export type LiFiStepRequest = (LiFiStep | SignedLiFiStep) & {
  action: Action & OrderFields
}

export type QuoteRequestFromAmount = QuoteRequestBase

export type QuoteRequestToAmount = Omit<QuoteRequestBase, 'fromAmount'> & {
  toAmount: string
}

export type QuoteRequest = QuoteRequestFromAmount | QuoteRequestToAmount
