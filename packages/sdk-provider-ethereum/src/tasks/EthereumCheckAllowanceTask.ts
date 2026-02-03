import type { TaskContext, TaskResult } from '@lifi/sdk'
import { isZeroAddress } from '../utils/isZeroAddress.js'
import { EthereumStepExecutionTask } from './EthereumStepExecutionTask.js'
import { checkAllowance } from './helpers/checkAllowance.js'
import { checkAllowanceBatchingSupported } from './helpers/checkAllowanceBatchingSupported.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumCheckAllowanceTask extends EthereumStepExecutionTask<void> {
  readonly type = 'ETHEREUM_CHECK_ALLOWANCE'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<boolean> {
    const { step, action, fromChain } = context

    const isFromNativeToken =
      fromChain.nativeToken.address === step.action.fromToken.address &&
      isZeroAddress(step.action.fromToken.address)

    return (
      // No existing swap/bridge transaction is pending
      !action?.txHash &&
      // No existing swap/bridge batch/order is pending
      !action?.taskId &&
      // Token is not native (address is not zero)
      !isFromNativeToken &&
      // Approval address is required for allowance checks, but may be null in special cases (e.g. direct transfers)
      !!step.estimate.approvalAddress &&
      !step.estimate.skipApproval &&
      action.status !== 'DONE'
    )
  }

  async run(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<void>> {
    const { client, step, allowUserInteraction, checkClient } = context

    const disableMessageSigning =
      context.executionOptions?.disableMessageSigning || step.type !== 'lifi'

    // Check if token needs approval and get approval transaction or message data when available
    const allowanceResult = context.batchingSupported
      ? await checkAllowanceBatchingSupported(client, {
          checkClient,
          chain: context.fromChain,
          step,
          statusManager: context.statusManager,
          executionOptions: context.executionOptions,
          allowUserInteraction,
          permit2Supported: context.permit2Supported,
          disableMessageSigning,
        })
      : await checkAllowance(client, {
          checkClient,
          chain: context.fromChain,
          step,
          statusManager: context.statusManager,
          executionOptions: context.executionOptions,
          allowUserInteraction,
          permit2Supported: context.permit2Supported,
          disableMessageSigning,
        })

    switch (allowanceResult.status) {
      case 'BATCH_APPROVAL':
        context.calls.push(...allowanceResult.data.calls)
        context.signedTypedData = allowanceResult.data.signedTypedData
        break
      case 'NATIVE_PERMIT':
        context.signedTypedData = allowanceResult.data
        break
      case 'DONE':
        context.signedTypedData = allowanceResult.data
        break
      default:
        if (!allowUserInteraction) {
          return { status: 'PAUSED' }
        }
        break
    }

    return { status: 'COMPLETED' }
  }
}
