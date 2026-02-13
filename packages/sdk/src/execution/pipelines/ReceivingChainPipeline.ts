import { TaskPipeline } from '../../core/TaskPipeline.js'
import type { ExecutionAction } from '../../types/core.js'
import type { StepExecutorContext } from '../../types/execution.js'
import { WaitForTransactionStatusTask } from '../tasks/WaitForTransactionStatusTask.js'

export class ReceivingChainPipeline extends TaskPipeline {
  constructor() {
    super('RECEIVING_CHAIN', [new WaitForTransactionStatusTask()])
  }

  override async shouldRun(
    context: StepExecutorContext,
    action?: ExecutionAction
  ): Promise<boolean> {
    const { isBridgeExecution } = context
    return action?.status !== 'DONE' && isBridgeExecution
  }
}
