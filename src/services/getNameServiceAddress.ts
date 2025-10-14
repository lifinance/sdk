import type { ChainType } from '@lifi/types'
import type { SDKBaseConfig } from '../core/types.js'

export const getNameServiceAddress = async (
  config: SDKBaseConfig,
  name: string,
  chainType?: ChainType
): Promise<string | undefined> => {
  try {
    let providers = config.providers
    if (chainType) {
      providers = providers.filter((provider) => provider.type === chainType)
    }
    const resolvers = providers.map((provider) => provider.resolveAddress)
    if (!resolvers.length) {
      return
    }
    const result = await Promise.any(
      resolvers.map(async (resolve) => {
        const address = await resolve(name)
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
