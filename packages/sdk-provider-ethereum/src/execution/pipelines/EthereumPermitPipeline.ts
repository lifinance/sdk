import { type ExecutionAction, TaskPipeline } from '@lifi/sdk'
import type { EthereumStepExecutorContext } from '../../types.js'
import { EthereumCheckPermitsTask } from '../tasks/EthereumCheckPermitsTask.js'
import { shouldCheckForAllowance } from '../tasks/helpers/shouldCheckForAllowance.js'

export class EthereumPermitPipeline extends TaskPipeline {
  constructor() {
    super('PERMIT', [new EthereumCheckPermitsTask()])
  }

  override async shouldRun(
    context: EthereumStepExecutorContext,
    _action?: ExecutionAction
  ): Promise<boolean> {
    const {
      statusManager,
      step,
      isFromNativeToken,
      isBridgeExecution,
      disableMessageSigning,
    } = context
    const permitTypedData = context.step.typedData?.filter(
      (typedData) => typedData.primaryType === 'Permit'
    )
    return (
      shouldCheckForAllowance(
        step,
        isBridgeExecution,
        isFromNativeToken,
        statusManager
      ) &&
      !!permitTypedData?.length &&
      !disableMessageSigning
    )
  }
}
