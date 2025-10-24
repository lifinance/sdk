import type { ChainType } from '@lifi/types'
import type { SDKClient } from '../types/core.js'

/**
 * Get the address of a name service
 * @param client - The SDK client
 * @param name - The name to resolve
 * @param chainType - The chain type to resolve the name on
 * @returns The address of the name service
 */
export const getNameServiceAddress = async (
  client: SDKClient,
  name: string,
  chainType?: ChainType
): Promise<string | undefined> => {
  try {
    let providers = []
    if (chainType) {
      providers = client.providers.filter(
        (provider) => provider.type === chainType
      )
    } else {
      providers = client.providers
    }
    const resolvers = providers.map((provider) => provider.resolveAddress)
    if (!resolvers.length) {
      return
    }
    const result = await Promise.any(
      resolvers.map(async (resolve) => {
        const address = await resolve(name, client)
        if (!address) {
          throw undefined
        }
        return address
      })
    )
    return result
  } catch (_) {
    return
  }
}
