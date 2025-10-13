import type { RequestOptions, ToolsRequest, ToolsResponse } from '@lifi/types'
import type { SDKBaseConfig } from '../core/types.js'
import { request } from '../request.js'

/**
 * Get the available tools to bridge and swap tokens.
 * @param params - The configuration of the requested tools
 * @param options - Request options
 * @returns The tools that are available on the requested chains
 */
export const getTools = async (
  config: SDKBaseConfig,
  params?: ToolsRequest,
  options?: RequestOptions
): Promise<ToolsResponse> => {
  if (params) {
    for (const key of Object.keys(params)) {
      if (!params[key as keyof ToolsRequest]) {
        delete params[key as keyof ToolsRequest]
      }
    }
  }
  return await request<ToolsResponse>(
    config,
    `${config.apiUrl}/tools?${new URLSearchParams(
      params as Record<string, string>
    )}`,
    {
      signal: options?.signal,
    }
  )
}
