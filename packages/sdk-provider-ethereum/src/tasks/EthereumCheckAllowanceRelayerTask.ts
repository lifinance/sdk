import {
  BaseStepExecutionTask,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import {
  getPermit2Supported,
  shouldRunAllowanceCheck,
} from './helpers/allowanceTaskHelpers.js'
import { checkAllowance } from './helpers/checkAllowance.js'
import { checkClient as checkClientHelper } from './helpers/checkClient.js'
import type { EthereumTaskExtra } from './types.js'

/** Relayer execution: same as standard (on-chain approval or native permit); relayer handles the main tx. */
export class EthereumCheckAllowanceRelayerTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  void
> {
  readonly type = 'ETHEREUM_CHECK_ALLOWANCE_RELAYER'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<boolean> {
    return (
      context.executionStrategy === 'relayer' &&
      shouldRunAllowanceCheck(context)
    )
  }

  override async run(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<void>> {
    context.calls = context.calls ?? []
    context.signedTypedData = context.signedTypedData ?? []
    const { client, step, allowUserInteraction } = context
    const disableMessageSigning =
      context.executionOptions?.disableMessageSigning || step.type !== 'lifi'

    const allowanceResult = await checkAllowance(client, {
      checkClient: (s, a, tid) =>
        checkClientHelper(s, a, tid, {
          getClient: context.getClient,
          setClient: context.setClient,
          statusManager: context.statusManager,
          allowUserInteraction: context.allowUserInteraction,
          switchChain: context.switchChain,
        }),
      chain: context.fromChain,
      step,
      statusManager: context.statusManager,
      executionOptions: context.executionOptions,
      allowUserInteraction,
      permit2Supported: getPermit2Supported(context),
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
