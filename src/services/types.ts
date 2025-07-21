import type { GetStatusRequest } from '@lifi/types'

export type GetStatusRequestExtended = GetStatusRequest & {
  fromAddress?: string
}
