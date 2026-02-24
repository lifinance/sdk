import {
  BaseStepExecutionTask,
  type SignedTypedData,
  type TaskResult,
} from '@lifi/sdk'
import { signTypedData } from 'viem/actions'
import { getAction } from 'viem/utils'
import type { EthereumStepExecutorContext } from '../../types.js'
import { getDomainChainId } from '../../utils/getDomainChainId.js'

export class EthereumCheckPermitsTask extends BaseStepExecutionTask {
  override async shouldRun(
    context: EthereumStepExecutorContext
  ): Promise<boolean> {
    const { step, disableMessageSigning } = context

    const permitTypedData = step.typedData?.filter(
      (typedData) => typedData.primaryType === 'Permit'
    )

    return !!permitTypedData?.length && !disableMessageSigning
  }

  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
    const {
      step,
      statusManager,
      allowUserInteraction,
      checkClient,
      tasksResults,
    } = context

    const action = statusManager.findOrCreateAction({
      step,
      type: 'PERMIT',
      chainId: step.action.fromChainId,
    })

    // First, try to sign all permits in step.typedData
    const permitTypedData =
      step.typedData?.filter(
        (typedData) => typedData.primaryType === 'Permit'
      ) ?? []

    const signedTypedData = [...tasksResults.signedTypedData]
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
      result: { signedTypedData, hasMatchingPermit: !!matchingPermit },
    }
  }
}
