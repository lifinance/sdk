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
    const { step, extra } = context
    const { action, fromChain } = extra
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
    const { client, step, extra, allowUserInteraction } = context

    const checkClient = (
      s: typeof step,
      a: typeof extra.action,
      tid?: number
    ) => checkClientHelper(s, a, tid, extra.checkClientDeps)

    const allowanceResult = await checkAllowance(client, {
      checkClient,
      chain: extra.fromChain,
      step,
      statusManager: extra.statusManager,
      executionOptions: extra.executionOptions,
      allowUserInteraction,
      batchingSupported: extra.batchingSupported,
      permit2Supported: extra.permit2Supported,
      disableMessageSigning: extra.disableMessageSigning,
    })

    switch (allowanceResult.status) {
      case 'BATCH_APPROVAL':
        extra.calls.push(...allowanceResult.data.calls)
        extra.signedTypedData = allowanceResult.data.signedTypedData
        break
      case 'NATIVE_PERMIT':
        extra.signedTypedData = allowanceResult.data
        break
      case 'DONE':
        extra.signedTypedData = allowanceResult.data
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
