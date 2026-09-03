import type { ExtendedChain } from '@lifi/sdk'
import {
  BaseStepExecutionTask,
  type LiFiStepExtended,
  type SignedTypedData,
  type TaskResult,
  type TypedData,
} from '@lifi/sdk'
import { signTypedData } from 'viem/actions'
import { getAction } from 'viem/utils'
import type { EthereumStepExecutorContext } from '../../types.js'
import { getDomainChainId } from '../../utils/getDomainChainId.js'
import { isGaslessStep } from '../../utils/isGaslessStep.js'
import { assertValidSignature } from '../../utils/isValidSignature.js'

export class EthereumCheckPermitsTask extends BaseStepExecutionTask {
  /**
   * Typed data this task signs inline (as opposed to the relayer sign task).
   * EIP-2612 native permits (`primaryType === 'Permit'`) are always signed here.
   * Any other intent typed data — e.g. a Permit2 `PermitSingle` for a non-LI.FI
   * spender that `getStepTransaction` embeds into the step's own transaction —
   * is signed here only for non-gasless steps; a gasless/relayer step has its
   * typed data signed by `EthereumRelayedSignAndExecuteTask` instead.
   */
  private signableTypedData(
    step: LiFiStepExtended,
    fromChain: ExtendedChain
  ): TypedData[] {
    return (
      step.typedData?.filter(
        (typedData) =>
          typedData.primaryType === 'Permit' || !isGaslessStep(step, fromChain)
      ) ?? []
    )
  }

  override async shouldRun(
    context: EthereumStepExecutorContext
  ): Promise<boolean> {
    const { step, fromChain, disableMessageSigning } = context

    return (
      !!this.signableTypedData(step, fromChain).length && !disableMessageSigning
    )
  }

  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
    const {
      step,
      fromChain,
      statusManager,
      allowUserInteraction,
      checkClient,
      signedTypedData: currentSignedTypedData,
    } = context

    const action = statusManager.initializeAction({
      step,
      type: 'PERMIT',
      chainId: step.action.fromChainId,
      status: 'STARTED',
    })

    const permitTypedData = this.signableTypedData(step, fromChain)

    const signedTypedData = [...currentSignedTypedData]
    for (const typedData of permitTypedData) {
      statusManager.updateAction(step, action.type, 'ACTION_REQUIRED')

      if (!allowUserInteraction) {
        return { status: 'PAUSED' }
      }

      const typedDataChainId =
        getDomainChainId(typedData.domain) || step.action.fromChainId

      // Switch to the permit's chain if needed
      const permitClient = await checkClient(step, typedDataChainId)
      if (!permitClient) {
        return { status: 'PAUSED' }
      }

      const signature = await getAction(
        permitClient,
        signTypedData,
        'signTypedData'
      )({
        account: permitClient.account!,
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      })
      assertValidSignature(signature)
      const signedPermit: SignedTypedData = {
        ...typedData,
        signature,
      }
      signedTypedData.push(signedPermit)
    }

    // Check if there's a signed permit for the source transaction chain
    const matchingPermit = signedTypedData.find(
      (signedTypedData) =>
        getDomainChainId(signedTypedData.domain) === step.action.fromChainId
    )

    statusManager.updateAction(step, action.type, 'DONE')

    return {
      status: 'COMPLETED',
      context: { signedTypedData, hasMatchingPermit: !!matchingPermit },
    }
  }
}
