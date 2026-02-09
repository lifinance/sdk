import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type SignedTypedData,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import { EthereumCheckAllowanceTask } from './EthereumCheckAllowanceTask.js'
import { EthereumPrepareTransactionTask } from './EthereumPrepareTransactionTask.js'
import { checkPermitTypedData } from './helpers/checkPermitTypedData.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumCheckAndExecuteTask extends BaseStepExecutionTask<EthereumTaskExtra> {
  readonly type = 'ETHEREUM_CHECK_AND_EXECUTE'
  readonly actionType = 'EXCHANGE'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>,
    action?: ExecutionAction
  ): Promise<boolean> {
    return !context.isTransactionExecuted(action)
  }

  protected async run(
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
      return await new EthereumPrepareTransactionTask().execute(context, {
        signedTypedData,
      })
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
      return await new EthereumPrepareTransactionTask().execute(context, {
        signedTypedData,
      })
    }

    return await new EthereumCheckAllowanceTask().execute(context, {
      signedTypedData,
    })
  }
}
