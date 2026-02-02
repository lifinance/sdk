import type { Client } from '@bigmi/core'
import type {
  ExecutionActionType,
  ExecutionOptions,
  LiFiStepExtended,
  SDKClient,
  StatusManager,
  TaskContext,
} from '@lifi/sdk'
import { ChainId } from '@lifi/sdk'
import { getBitcoinPublicClient } from '../client/publicClient.js'
import type { BitcoinTaskExtra } from './types.js'

export interface GetBitcoinPipelineContextDeps {
  walletClient: Client
  statusManager: StatusManager
  executionOptions?: ExecutionOptions
  allowUserInteraction: boolean
}

/**
 * Resolves chains, action type, action, and public client for the Bitcoin task pipeline.
 * Returns baseContext ready for pipeline.run() / pipeline.resume().
 */
export async function getBitcoinPipelineContext(
  client: SDKClient,
  step: LiFiStepExtended,
  deps: GetBitcoinPipelineContextDeps
): Promise<Omit<TaskContext<BitcoinTaskExtra>, 'pipelineContext'>> {
  const fromChain = await client.getChainById(step.action.fromChainId)
  const toChain = await client.getChainById(step.action.toChainId)

  const isBridgeExecution = fromChain.id !== toChain.id
  const currentActionType: ExecutionActionType = isBridgeExecution
    ? 'CROSS_CHAIN'
    : 'SWAP'

  const action = deps.statusManager.findOrCreateAction({
    step,
    type: currentActionType,
    chainId: fromChain.id,
  })

  const publicClient = await getBitcoinPublicClient(client, ChainId.BTC)

  return {
    client,
    step,
    chain: fromChain,
    allowUserInteraction: deps.allowUserInteraction,
    walletClient: deps.walletClient,
    statusManager: deps.statusManager,
    executionOptions: deps.executionOptions,
    fromChain,
    toChain,
    isBridgeExecution,
    actionType: currentActionType,
    action,
    publicClient,
  }
}
