import type { RequestOptions, ToolsRequest, ToolsResponse } from '@lifi/types'
import { request } from '../request.js'
import type { SDKClient } from '../types/core.js'

/**
 * Get the available tools to bridge and swap tokens.
 * @param client - The SDK client
 * @param params - The configuration of the requested tools
 * @param options - Request options
 * @returns The tools that are available on the requested chains
 */
export const getTools = async (
  client: SDKClient,
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
    client.config,
    `${client.config.apiUrl}/tools?${new URLSearchParams(
      params as Record<string, string>
    )}`,
    {
      signal: options?.signal,
    }
  )
}
