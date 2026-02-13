import type {
  ExecuteStepRetryParams,
  ExtendedChain,
  LiFiStepExtended,
  SDKClient,
} from '@lifi/sdk'
import type { Client } from 'viem'
import { isBatchingSupported } from '../../../actions/isBatchingSupported.js'
import type { EthereumExecutionStrategy } from '../../../types.js'
import { isRelayerStep } from '../../../utils/isRelayerStep.js'

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
  // Batching via EIP-5792 is disabled in the next cases:
  // 1. When atomicity is not ready or the wallet rejected the upgrade to 7702 account (atomicityNotReady is true)
  // 2. When the step is using thorswap tool (temporary disabled)
  // 3. When using relayer transactions
  const batchingSupported =
    atomicityNotReady || step.tool === 'thorswap'
      ? false
      : await isBatchingSupported(client, {
          client: viemClient,
          chainId: fromChain.id,
        })
  return batchingSupported ? 'batch' : 'standard'
}
