import type { ExtendedChain } from '@lifi/sdk'
import type { Chain, Client } from 'viem'
import { convertExtendedChain } from './convertExtendedChain.js'

// A matching `client.chain` keeps its fees and serializers, which a converted
// chain does not have; a stale or missing one gives way to the step's chain.
export const getStepChain = (client: Client, chain: ExtendedChain): Chain =>
  client.chain?.id === chain.id ? client.chain : convertExtendedChain(chain)
