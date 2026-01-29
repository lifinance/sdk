import type { ExecutionTask, TaskContext, TaskResult } from '@lifi/sdk'
import { checkAllowance } from '../actions/checkAllowance.js'
import { isZeroAddress } from '../utils/isZeroAddress.js'
import { checkClient as checkClientHelper } from './helpers/checkClient.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumCheckAllowanceTask
  implements ExecutionTask<EthereumTaskExtra, void>
{
  readonly type = 'ETHEREUM_CHECK_ALLOWANCE'
  readonly displayName = 'Check allowance'

  async shouldRun(context: TaskContext<EthereumTaskExtra>): Promise<boolean> {
    const { step, action, fromChain } = context
    if (action.txHash || action.taskId) {
      return false
    }
    const isFromNativeToken =
      fromChain.nativeToken.address === step.action.fromToken.address &&
      isZeroAddress(step.action.fromToken.address)
    if (isFromNativeToken) {
      return false
    }
    return !!step.estimate.approvalAddress && !step.estimate.skipApproval
  }

  async execute(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<void>> {
    const { client, step, action, allowUserInteraction, checkClientDeps } =
      context

    const checkClient = (s: typeof step, a: typeof action, tid?: number) =>
      checkClientHelper(s, a, tid, checkClientDeps)

    const allowanceResult = await checkAllowance(client, {
      checkClient,
      chain: context.fromChain,
      step,
      statusManager: context.statusManager,
      executionOptions: context.executionOptions,
      allowUserInteraction,
      batchingSupported: context.batchingSupported,
      permit2Supported: context.permit2Supported,
      disableMessageSigning: context.disableMessageSigning,
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
