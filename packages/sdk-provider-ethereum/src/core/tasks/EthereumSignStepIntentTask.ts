import { BaseStepExecutionTask, type TaskResult } from '@lifi/sdk'
import type { EthereumStepExecutorContext } from '../../types.js'
import {
  getTypedDataInLane,
  isCallerIntentLane,
} from '../../utils/getTypedDataLane.js'
import { signTypedDataEntries } from './helpers/signTypedDataEntries.js'

/** Signs the Permit2 messages a caller attached to its own step, before prepare. */
export class EthereumSignStepIntentTask extends BaseStepExecutionTask {
  override async shouldRun(
    context: EthereumStepExecutorContext
  ): Promise<boolean> {
    const { step, fromChain, disableMessageSigning } = context

    return isCallerIntentLane(step, fromChain) && !disableMessageSigning
  }

  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
    const { step, fromChain, statusManager } = context

    const action = statusManager.initializeAction({
      step,
      type: 'PERMIT',
      chainId: step.action.fromChainId,
      status: 'STARTED',
    })

    const intentTypedData = getTypedDataInLane(step, 'caller-intent', fromChain)

    // `ACTION_REQUIRED`, not `MESSAGE_REQUIRED`: the widget maps no `PERMIT`
    // text for it. Pinned by `emits exactly STARTED, ACTION_REQUIRED and DONE`.
    const result = await signTypedDataEntries(
      context,
      intentTypedData,
      action.type
    )
    if (result.status === 'PAUSED') {
      return { status: 'PAUSED' }
    }

    statusManager.updateAction(step, action.type, 'DONE')

    return {
      status: 'COMPLETED',
      context: { signedTypedData: result.signedTypedData },
    }
  }
}
