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
   * Native permits (`primaryType === 'Permit'`) are always signed here; any
   * other intent typed data (e.g. a Permit2 `PermitSingle`) only for non-gasless
   * steps — gasless steps sign it in `EthereumRelayedSignAndExecuteTask`.
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

    // Only a native EIP-2612 permit stands in for the ERC-20 allowance; a
    // Permit2 `PermitSingle` still needs the token → Permit2 approval.
    const matchingPermit = signedTypedData.find(
      (signedTypedData) =>
        signedTypedData.primaryType === 'Permit' &&
        getDomainChainId(signedTypedData.domain) === step.action.fromChainId
    )

    statusManager.updateAction(step, action.type, 'DONE')

    return {
      status: 'COMPLETED',
      context: { signedTypedData, hasMatchingPermit: !!matchingPermit },
    }
  }
}
