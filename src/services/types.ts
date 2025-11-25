import type {
  GetStatusRequest,
  QuoteRequest as QuoteRequestBase,
} from '@lifi/types'

export type GetStatusRequestExtended = GetStatusRequest & {
  fromAddress?: string
}

export type GetStepTransactionRequest = {
  jitoBundle?: boolean
}

export type QuoteRequestFromAmount = QuoteRequestBase

export type QuoteRequestToAmount = Omit<QuoteRequestBase, 'fromAmount'> & {
  toAmount: string
}

export type QuoteRequest = QuoteRequestFromAmount | QuoteRequestToAmount
