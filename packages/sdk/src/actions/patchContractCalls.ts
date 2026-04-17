import type { PatchCallDataRequest, RequestOptions } from '@lifi/types'
import type { SDKClient } from '../types/core.js'
import { request } from '../utils/request.js'

export interface PatchContractCallsResponse {
  target: string
  value: bigint
  callData: string
  allowFailure: boolean
  isDelegateCall: boolean
}

export const patchContractCalls = async (
  client: SDKClient,
  params: PatchCallDataRequest,
  options?: RequestOptions
): Promise<PatchContractCallsResponse[]> => {
  return await request<PatchContractCallsResponse[]>(
    client.config,
    `${client.config.apiUrl}/patcher`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
      signal: options?.signal,
    }
  )
}
