import type {
  ExecutionAction,
  ExecutionActionType,
  ExecutionOptions,
  LiFiStepExtended,
  SDKClient,
  SignedTypedData,
  StatusManager,
  TaskContext,
} from '@lifi/sdk'
import type { Client } from 'viem'
import { isBatchingSupported } from '../../actions/isBatchingSupported.js'
import type { Call } from '../../types.js'
import { isRelayerStep } from '../../utils/isRelayerStep.js'
import { isZeroAddress } from '../../utils/isZeroAddress.js'
import type { EthereumTaskExtra } from '../types.js'
import { checkClient as checkClientHelper } from './checkClient.js'

export interface GetEthereumPipelineContextDeps {
  statusManager: StatusManager
  executionOptions?: ExecutionOptions
  ethereumClient: Client
  allowUserInteraction: boolean
  switchChain?: (chainId: number) => Promise<Client | undefined>
}

/**
 * Resolves chains, batching/permit2 flags, and pipeline context.
 */
export async function getEthereumPipelineContext(
  client: SDKClient,
  step: LiFiStepExtended,
  atomicityNotReady: boolean,
  deps: GetEthereumPipelineContextDeps
): Promise<Omit<TaskContext<EthereumTaskExtra>, 'pipelineContext'>> {
  const fromChain = await client.getChainById(step.action.fromChainId)
  const toChain = await client.getChainById(step.action.toChainId)

  // Check if the wallet supports atomic batch transactions (EIP-5792)
  const calls: Call[] = []
  // Signed typed data for native permits and other messages
  const signedTypedData: SignedTypedData[] = []

  // Batching via EIP-5792 is disabled in the next cases:
  // 1. When atomicity is not ready or the wallet rejected the upgrade to 7702 account (atomicityNotReady is true)
  // 2. When the step is using thorswap tool (temporary disabled)
  // 3. When using relayer transactions
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

  // Check if message signing is disabled - useful for smart contract wallets
  // We also disable message signing for custom steps
  const disableMessageSigning =
    deps.executionOptions?.disableMessageSigning || step.type !== 'lifi'

  // Check if chain has Permit2 contract deployed. Permit2 should not be available for atomic batch.
  const permit2Supported =
    !!fromChain.permit2 &&
    !!fromChain.permit2Proxy &&
    !batchingSupported &&
    !isFromNativeToken &&
    !disableMessageSigning &&
    // Approval address is not required for Permit2 per se, but we use it to skip allowance checks for direct transfers
    !!step.estimate.approvalAddress &&
    !step.estimate.skipApproval &&
    !step.estimate.skipPermit

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
    ethereumClient: deps.ethereumClient,
    checkClient: (
      s: LiFiStepExtended,
      a: ExecutionAction,
      targetChainId?: number
    ) =>
      checkClientHelper(s, a, targetChainId, {
        getClient: () => deps.ethereumClient,
        setClient: (c: Client) => {
          deps.ethereumClient = c
        },
        statusManager: deps.statusManager,
        allowUserInteraction: deps.allowUserInteraction,
        switchChain: deps.switchChain,
      }),
  }
}
