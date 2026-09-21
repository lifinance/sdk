import { BaseStepExecutionTask, type TaskResult } from '@lifi/sdk'
import type { EthereumStepExecutorContext } from '../../types.js'
import { getDomainChainId } from '../../utils/getDomainChainId.js'
import {
  getTypedDataInLane,
  getTypedDataLane,
  isPermit2AllowanceLane,
} from '../../utils/getTypedDataLane.js'
import { signTypedDataEntries } from './helpers/signTypedDataEntries.js'

export class EthereumCheckPermitsTask extends BaseStepExecutionTask {
  override async shouldRun(
    context: EthereumStepExecutorContext
  ): Promise<boolean> {
    const { step, fromChain, disableMessageSigning } = context

    return (
      !!step.typedData?.some(
        (typedData) =>
          getTypedDataLane(typedData, fromChain) === 'native-permit'
      ) && !disableMessageSigning
    )
  }

  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
    const { step, fromChain, statusManager } = context

    const action = statusManager.initializeAction({
      step,
      type: 'PERMIT',
      chainId: step.action.fromChainId,
      status: 'STARTED',
    })

    const permitTypedData = getTypedDataInLane(step, 'native-permit', fromChain)

    const result = await signTypedDataEntries(
      context,
      permitTypedData,
      action.type
    )
    if (result.status === 'PAUSED') {
      return { status: 'PAUSED' }
    }
    const { signedTypedData } = result

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
        hasMatchingPermit:
          !!matchingPermit && !isPermit2AllowanceLane(step, fromChain),
      },
    }
  }
}
