import type {
  GetStatusRequest,
  QuoteRequest as QuoteRequestBase,
  RoutesRequest as RoutesRequestBase,
} from '@lifi/types'

export type GetStatusRequestExtended = GetStatusRequest & {
  fromAddress?: string
}

export type RoutesRequest = Omit<RoutesRequestBase, 'options'> & {
  options?: RoutesRequestBase['options'] & {
    private?: boolean
  }
}

export type QuoteRequestFromAmount = QuoteRequestBase

export type QuoteRequestToAmount = Omit<QuoteRequestBase, 'fromAmount'> & {
  toAmount: string
}

export type QuoteRequest = QuoteRequestFromAmount | QuoteRequestToAmount
