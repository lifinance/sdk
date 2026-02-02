import type {
  ExecutionActionType,
  ExecutionOptions,
  LiFiStepExtended,
  SDKClient,
  StatusManager,
  TaskContext,
} from '@lifi/sdk'
import type { WalletWithRequiredFeatures } from '@mysten/wallet-standard'
import type { SuiTaskExtra } from './types.js'

export interface GetSuiPipelineContextDeps {
  wallet: WalletWithRequiredFeatures
  statusManager: StatusManager
  executionOptions?: ExecutionOptions
  allowUserInteraction: boolean
}

/**
 * Resolves chains, action type, and action for the Sui task pipeline.
 * Returns baseContext ready for pipeline.run() / pipeline.resume().
 */
export async function getSuiPipelineContext(
  client: SDKClient,
  step: LiFiStepExtended,
  deps: GetSuiPipelineContextDeps
): Promise<Omit<TaskContext<SuiTaskExtra>, 'pipelineContext'>> {
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

  return {
    client,
    step,
    chain: fromChain,
    allowUserInteraction: deps.allowUserInteraction,
    wallet: deps.wallet,
    statusManager: deps.statusManager,
    executionOptions: deps.executionOptions,
    fromChain,
    toChain,
    isBridgeExecution,
    actionType: currentActionType,
    action,
  }
}
