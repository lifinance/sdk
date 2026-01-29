import {
  type ExecutionActionType,
  type ExecutionOptions,
  type LiFiStepExtended,
  type SDKClient,
  type SignedTypedData,
  type StatusManager,
  type TaskContext,
  waitForDestinationChainTransaction,
} from '@lifi/sdk'
import type { Client } from 'viem'
import { isBatchingSupported } from '../../actions/isBatchingSupported.js'
import type { Call } from '../../types.js'
import { isRelayerStep } from '../../utils/isRelayerStep.js'
import { isZeroAddress } from '../../utils/isZeroAddress.js'
import type { EthereumTaskExtra } from '../types.js'
import type { CheckClientDeps } from './checkClient.js'
import { checkClient as checkClientHelper } from './checkClient.js'
import { waitForTransaction as waitForTransactionHelper } from './waitForTransaction.js'

export interface GetEthereumPipelineContextDeps {
  statusManager: StatusManager
  executionOptions?: ExecutionOptions
  ethereumClient: Client
  allowUserInteraction: boolean
  checkClientDeps: CheckClientDeps
}

/**
 * Resolves chains, batching/permit2 flags, and pipeline context.
 * Handles early exits (action DONE or txHash/taskId) by performing the wait and returning 'earlyExit'.
 */
export async function getEthereumPipelineContext(
  client: SDKClient,
  step: LiFiStepExtended,
  atomicityNotReady: boolean,
  deps: GetEthereumPipelineContextDeps
): Promise<
  | { baseContext: Omit<TaskContext<EthereumTaskExtra>, 'pipelineContext'> }
  | { earlyExit: true }
> {
  const fromChain = await client.getChainById(step.action.fromChainId)
  const toChain = await client.getChainById(step.action.toChainId)
  const calls: Call[] = []
  const signedTypedData: SignedTypedData[] = []

  const batchingSupported =
    atomicityNotReady || step.tool === 'thorswap' || isRelayerStep(step)
      ? false
      : await isBatchingSupported(client, {
          client: deps.ethereumClient,
          chainId: fromChain.id,
        })

  const isBridgeExecution = fromChain.id !== toChain.id
  const currentActionType: ExecutionActionType = isBridgeExecution
    ? 'CROSS_CHAIN'
    : 'SWAP'
  const isFromNativeToken =
    fromChain.nativeToken.address === step.action.fromToken.address &&
    isZeroAddress(step.action.fromToken.address)
  const disableMessageSigning =
    deps.executionOptions?.disableMessageSigning || step.type !== 'lifi'
  const permit2Supported =
    !!fromChain.permit2 &&
    !!fromChain.permit2Proxy &&
    !batchingSupported &&
    !isFromNativeToken &&
    !disableMessageSigning &&
    !!step.estimate.approvalAddress &&
    !step.estimate.skipApproval &&
    !step.estimate.skipPermit

  const existingAction = step.execution?.actions.find(
    (p) => p.type === currentActionType
  )

  if (existingAction?.status === 'DONE') {
    await waitForDestinationChainTransaction(
      client,
      step,
      existingAction,
      fromChain,
      toChain,
      deps.statusManager
    )
    return { earlyExit: true }
  }

  if (existingAction?.txHash || existingAction?.taskId) {
    const updatedClient = await checkClientHelper(
      step,
      existingAction,
      undefined,
      deps.checkClientDeps
    )
    if (!updatedClient) {
      return { earlyExit: true }
    }
    await waitForTransactionHelper(
      client,
      {
        step,
        action: existingAction,
        fromChain,
        toChain,
        isBridgeExecution,
      },
      { statusManager: deps.statusManager, ethereumClient: deps.ethereumClient }
    )
    return { earlyExit: true }
  }

  const action = deps.statusManager.findOrCreateAction({
    step,
    type: currentActionType,
    status: 'STARTED',
    chainId: fromChain.id,
  })

  const baseContext = {
    client,
    step,
    chain: fromChain,
    allowUserInteraction: deps.allowUserInteraction,
    statusManager: deps.statusManager,
    executionOptions: deps.executionOptions,
    fromChain,
    toChain,
    isBridgeExecution,
    actionType: currentActionType,
    action,
    calls,
    signedTypedData,
    batchingSupported,
    permit2Supported,
    disableMessageSigning,
    ethereumClient: deps.ethereumClient,
    checkClientDeps: deps.checkClientDeps,
  }
  return { baseContext }
}
