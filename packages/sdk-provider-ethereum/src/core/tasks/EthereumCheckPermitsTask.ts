import {
  BaseStepExecutionTask,
  type SignedTypedData,
  type TaskResult,
} from '@lifi/sdk'
import { signTypedData } from 'viem/actions'
import { getAction } from 'viem/utils'
import type { EthereumStepExecutorContext } from '../../types.js'
import { getDomainChainId } from '../../utils/getDomainChainId.js'
import {
  getTypedDataLane,
  hasCallerIntent,
} from '../../utils/getTypedDataLane.js'
import { assertValidSignature } from '../../utils/isValidSignature.js'

export class EthereumCheckPermitsTask extends BaseStepExecutionTask {
  override async shouldRun(
    context: EthereumStepExecutorContext
  ): Promise<boolean> {
    const { step, fromChain, disableMessageSigning } = context

    const permitTypedData = step.typedData?.filter(
      (typedData) => getTypedDataLane(typedData, fromChain) === 'native-permit'
    )

    return !!permitTypedData?.length && !disableMessageSigning
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

    // Only native EIP-2612 permits are signed here. Caller-supplied Permit2
    // intents belong to EthereumSignStepIntentTask, which runs after the
    // allowance work.
    const permitTypedData =
      step.typedData?.filter(
        (typedData) =>
          getTypedDataLane(typedData, fromChain) === 'native-permit'
      ) ?? []

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

    // Only a native EIP-2612 permit stands in for the ERC-20 allowance.
    const matchingPermit = signedTypedData.find(
      (entry) =>
        entry.primaryType === 'Permit' &&
        getDomainChainId(entry.domain) === step.action.fromChainId
    )

    statusManager.updateAction(step, action.type, 'DONE')

    return {
      status: 'COMPLETED',
      context: {
        signedTypedData,
        // A caller's Permit2 intent still needs the token -> Permit2 approval,
        // so the allowance tasks must not be skipped even with a native permit
        // in hand.
        hasMatchingPermit:
          !!matchingPermit && !hasCallerIntent(step, fromChain),
      },
    }
  }
}
