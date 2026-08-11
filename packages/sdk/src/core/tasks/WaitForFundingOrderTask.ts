import { getFundingOrder } from '../../actions/getFundingOrder.js'
import { waitForFundingOrder } from '../../actions/waitForFundingOrder.js'
import { LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError } from '../../errors/errors.js'
import type { ExecutionActionType } from '../../types/core.js'
import type { StepExecutorContext, TaskResult } from '../../types/execution.js'
import type { FundingOrder } from '../../types/funding.js'
import { BaseStepExecutionTask } from '../BaseStepExecutionTask.js'

/**
 * Wait slot for funding-order steps. Reports the source txHash to the order
 * endpoint, then polls the order (not /status) to a terminal state.
 */
export class WaitForFundingOrderTask extends BaseStepExecutionTask {
  readonly actionType: ExecutionActionType

  constructor(actionType: ExecutionActionType) {
    super()
    this.actionType = actionType
  }

  async run(context: StepExecutorContext): Promise<TaskResult> {
    const { client, step, statusManager, isBridgeExecution } = context
    const orderId = step.fundingOrderId!

    const sourceAction = statusManager.findAction(
      step,
      isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )
    const txHash = sourceAction?.txHash

    const action = statusManager.initializeAction({
      step,
      type: this.actionType,
      chainId:
        this.actionType === 'RECEIVING_CHAIN'
          ? step.action.toChainId
          : step.action.fromChainId,
      status: 'PENDING',
    })

    // Report the source transaction. Non-fatal: the backend can also find
    // it through its own indexers, so a failed report must not stop polling.
    if (txHash) {
      await getFundingOrder(client, orderId, { txHash }).catch(() => undefined)
    }

    const onOrderUpdate = (
      context.executionOptions as
        | { onOrderUpdate?: (order: FundingOrder) => void }
        | undefined
    )?.onOrderUpdate

    const order = await waitForFundingOrder(client, orderId, {
      onUpdate: (updatedOrder) => {
        onOrderUpdate?.(updatedOrder)
        if (updatedOrder.status === 'PENDING') {
          statusManager.updateAction(step, action.type, 'PENDING', {
            // Deliberate cast: the funding order's substatus is an open
            // string (server-documented, not enumerated), while
            // ExecutionAction.substatus is typed as the @lifi/types
            // Substatus union. Do not widen that core type for this.
            substatus: updatedOrder.substatus as any,
          })
        }
      },
      pollingInterval: context.pollingIntervalMs,
    })

    if (order.status === 'FAILED') {
      throw new TransactionError(
        LiFiErrorCode.TransactionFailed,
        `Funding order ${orderId} failed${order.substatus ? ` (${order.substatus})` : ''}.`
      )
    }

    statusManager.updateAction(step, action.type, 'DONE', {
      chainId: step.action.toChainId,
      txHash: order.result?.toTxHash,
    })

    statusManager.updateExecution(step, {
      status: 'DONE',
      ...(order.result?.toAmount && { toAmount: order.result.toAmount }),
    })

    return { status: 'COMPLETED' }
  }
}
