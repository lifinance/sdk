import {
  ActionPipelineOrchestrator,
  BaseStepExecutionTask,
  type ExecutionAction,
  type SignedTypedData,
  type TaskContext,
  TaskPipeline,
  type TaskResult,
} from '@lifi/sdk'
import { EthereumCheckAllowanceTask } from './EthereumCheckAllowanceTask.js'
import { EthereumNativePermitTask } from './EthereumNativePermitTask.js'
import { EthereumResetAllowanceTask } from './EthereumResetAllowanceTask.js'
import { EthereumSetAllowanceTask } from './EthereumSetAllowanceTask.js'
import { EthereumWaitForApprovalTransactionTask } from './EthereumWaitForApprovalTransaction.js'
import { checkPermitTypedData } from './helpers/checkPermitTypedData.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumCheckPermitAndAllowanceTask extends BaseStepExecutionTask<EthereumTaskExtra> {
  private readonly pipeline: ActionPipelineOrchestrator<EthereumTaskExtra>

  constructor() {
    super()
    this.pipeline = new ActionPipelineOrchestrator<EthereumTaskExtra>([
      new TaskPipeline<EthereumTaskExtra>('TOKEN_ALLOWANCE', [
        new EthereumCheckAllowanceTask(),
        new EthereumNativePermitTask(),
        new EthereumResetAllowanceTask(),
        new EthereumSetAllowanceTask(),
        new EthereumWaitForApprovalTransactionTask(),
      ]),
    ])
  }

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>,
    action: ExecutionAction
  ): Promise<boolean> {
    return !context.isTransactionExecuted(action)
  }

  async run(
    context: TaskContext<EthereumTaskExtra>,
    action: ExecutionAction
  ): Promise<TaskResult> {
    const {
      step,
      statusManager,
      allowUserInteraction,
      checkClient,
      disableMessageSigning,
      isTransactionExecuted,
      isFromNativeToken,
    } = context

    let signedTypedData: SignedTypedData[] = []

    // Check if token needs approval and get approval transaction or message data when available
    const checkForAllowance =
      // No existing swap/bridge transaction is pending
      !isTransactionExecuted(action) &&
      // Token is not native (address is not zero)
      !isFromNativeToken &&
      // Approval address is required for allowance checks, but may be null in special cases (e.g. direct transfers)
      !!step.estimate.approvalAddress &&
      !step.estimate.skipApproval

    if (!checkForAllowance) {
      return {
        status: 'COMPLETED',
        data: {
          signedTypedData,
        },
      }
    }

    const result = await checkPermitTypedData(
      step,
      statusManager,
      allowUserInteraction,
      checkClient,
      disableMessageSigning,
      signedTypedData
    )

    if (!result) {
      return { status: 'PAUSED' }
    }

    signedTypedData = result.signedTypedData

    if (result.hasMatchingPermit) {
      return {
        status: 'COMPLETED',
        data: {
          signedTypedData,
        },
      }
    }

    return await this.pipeline.run(context, {
      signedTypedData,
    })
  }
}
