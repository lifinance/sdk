import type { StepExecutorBaseContext } from '@lifi/sdk'
import type { Client } from 'viem'
import { isBatchingSupported } from '../../actions/isBatchingSupported.js'
import { isRelayerStep } from '../../utils/isRelayerStep.js'
import type { EthereumExecutionStrategy } from '../types.js'

export async function getEthereumExecutionStrategy(
  baseContext: StepExecutorBaseContext,
  viemClient: Client
): Promise<EthereumExecutionStrategy> {
  const { step, client, fromChain } = baseContext
  const atomicityNotReady = !!baseContext.retryParams?.atomicityNotReady
  const isRelayer = isRelayerStep(step)
  const batchingSupported =
    atomicityNotReady || step.tool === 'thorswap' || isRelayer
      ? false
      : await isBatchingSupported(client, {
          client: viemClient,
          chainId: fromChain.id,
        })
  const executionStrategy: EthereumExecutionStrategy = isRelayer
    ? 'relayer'
    : batchingSupported
      ? 'batch'
      : 'standard'
  return executionStrategy
}
