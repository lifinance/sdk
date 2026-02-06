import type {
  ExecuteStepRetryParams,
  ExtendedChain,
  LiFiStepExtended,
  SDKClient,
} from '@lifi/sdk'
import type { Client } from 'viem'
import { isBatchingSupported } from '../../actions/isBatchingSupported.js'
import { isRelayerStep } from '../../utils/isRelayerStep.js'
import type { EthereumExecutionStrategy } from '../types.js'

export async function getEthereumExecutionStrategy(
  client: SDKClient,
  viemClient: Client,
  step: LiFiStepExtended,
  fromChain: ExtendedChain,
  retryParams?: ExecuteStepRetryParams
): Promise<EthereumExecutionStrategy> {
  const atomicityNotReady = !!retryParams?.atomicityNotReady
  const isRelayer = isRelayerStep(step)
  if (isRelayer) {
    return 'relayer'
  }
  const batchingSupported =
    atomicityNotReady || step.tool === 'thorswap'
      ? false
      : await isBatchingSupported(client, {
          client: viemClient,
          chainId: fromChain.id,
        })
  return batchingSupported ? 'batch' : 'standard'
}
