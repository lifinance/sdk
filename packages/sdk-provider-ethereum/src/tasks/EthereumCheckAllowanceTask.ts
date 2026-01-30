import type { ExecutionTask, TaskContext, TaskResult } from '@lifi/sdk'
import { checkAllowance } from '../actions/checkAllowance.js'
import { isZeroAddress } from '../utils/isZeroAddress.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumCheckAllowanceTask
  implements ExecutionTask<EthereumTaskExtra, void>
{
  readonly type = 'ETHEREUM_CHECK_ALLOWANCE'
  readonly displayName = 'Check allowance'

  async shouldRun(context: TaskContext<EthereumTaskExtra>): Promise<boolean> {
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

  async execute(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<void>> {
    const { client, step, allowUserInteraction, checkClient } = context

    const disableMessageSigning =
      context.executionOptions?.disableMessageSigning || step.type !== 'lifi'

    // Check if token needs approval and get approval transaction or message data when available
    const allowanceResult = await checkAllowance(client, {
      checkClient,
      chain: context.fromChain,
      step,
      statusManager: context.statusManager,
      executionOptions: context.executionOptions,
      allowUserInteraction,
      batchingSupported: context.batchingSupported,
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
