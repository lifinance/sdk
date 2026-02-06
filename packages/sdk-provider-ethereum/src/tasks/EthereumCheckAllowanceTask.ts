import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import { isZeroAddress } from '../utils/isZeroAddress.js'
import { EthereumGetAllowanceTask } from './EthereumGetAllowanceTask.js'
import { EthereumPrepareTransactionTask } from './EthereumPrepareTransactionTask.js'
import { checkPermitTypedData } from './helpers/checkPermitTypedData.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumCheckAllowanceTask extends BaseStepExecutionTask<EthereumTaskExtra> {
  readonly type = 'ETHEREUM_CHECK_ALLOWANCE'
  readonly actionType = 'EXCHANGE'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>,
    action?: ExecutionAction
  ): Promise<boolean> {
    const { step, fromChain } = context
    const isFromNativeToken =
      fromChain.nativeToken.address === step.action.fromToken.address &&
      isZeroAddress(step.action.fromToken.address)
    return (
      // No existing swap/bridge transaction is pending
      !context.isTransactionExecuted(action) &&
      // Token is not native (address is not zero)
      !isFromNativeToken &&
      // Approval address is required for allowance checks, but may be null in special cases (e.g. direct transfers)
      !!step.estimate.approvalAddress &&
      !step.estimate.skipApproval
    )
  }

  protected async run(
    context: TaskContext<EthereumTaskExtra>,
    _action: ExecutionAction
  ): Promise<TaskResult> {
    const {
      step,
      statusManager,
      allowUserInteraction,
      checkClient,
      executionOptions,
    } = context

    // Check if message signing is disabled - useful for smart contract wallets
    // We also disable message signing for custom steps
    const disableMessageSigning =
      executionOptions?.disableMessageSigning || step.type !== 'lifi'

    // First, try to sign all permits in step.typedData
    const result = await checkPermitTypedData(
      step,
      statusManager,
      allowUserInteraction,
      checkClient,
      disableMessageSigning
    )

    if (!result) {
      return { status: 'PAUSED' }
    }

    const { hasMatchingPermit, signedTypedData } = result

    if (hasMatchingPermit) {
      return await new EthereumPrepareTransactionTask().execute(context, {
        signedTypedData,
      })
    }

    return await new EthereumGetAllowanceTask().execute(context, {
      signedTypedData,
      disableMessageSigning,
    })
  }
}
