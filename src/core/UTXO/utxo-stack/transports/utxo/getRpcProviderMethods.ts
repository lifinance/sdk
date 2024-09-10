import { ankrMethods } from './ankr.js'
import { blockchairMethods } from './blockchair.js'
import { blockcypherMethods } from './blockcypher.js'
import { mempoolMethods } from './mempool.js'
import type { RpcMethods } from './types.js'

export function getRpcProviderMethods(
  key: 'blockchair' | 'ankr' | 'blockcypher' | 'mempool' | string
): RpcMethods | null {
  switch (key) {
    case 'blockchair':
      return blockchairMethods
    case 'ankr':
      return ankrMethods
    case 'blockcypher':
      return blockcypherMethods
    case 'mempool':
      return mempoolMethods
    default:
      return null
  }
}
