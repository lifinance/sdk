import type { ChainType } from '@lifi/types'
import { config } from '../config.js'

export const getNameServiceAddress = async (
  name: string,
  chainType?: ChainType
): Promise<string | undefined> => {
  try {
    let providers = config.get().providers
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
