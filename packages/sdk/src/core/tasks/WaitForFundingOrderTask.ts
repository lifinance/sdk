import { waitForFundingOrder } from '../../actions/waitForFundingOrder.js'
import { LiFiErrorCode } from '../../errors/constants.js'
import { ValidationError } from '../../errors/errors.js'
import { SDKError } from '../../errors/SDKError.js'
import type { ExecutionActionType } from '../../types/core.js'
import type { StepExecutorContext, TaskResult } from '../../types/execution.js'
import type {
  FundingExecutionOptions,
  FundingOrder,
} from '../../types/funding.js'
import { isFundingOrderStep } from '../../utils/fundingOrderStep.js'
import { BaseStepExecutionTask } from '../BaseStepExecutionTask.js'

/**
 * Wait slot for funding-order steps. Polls the order (not /status) to a
 * terminal state, reporting the source txHash until the order acknowledges it.
 *
 * A FAILED order is marked, not thrown: executeFundingOrder resolves with the
 * terminal order. A poll timeout returns PAUSED, so the execution stays
 * PENDING and resumable.
 */
export class WaitForFundingOrderTask extends BaseStepExecutionTask {
  readonly actionType: ExecutionActionType

  constructor(actionType: ExecutionActionType) {
    super()
    this.actionType = actionType
  }

  async run(context: StepExecutorContext): Promise<TaskResult> {
    const { client, step, statusManager, isBridgeExecution, toChain } = context
    if (!isFundingOrderStep(step)) {
      throw new ValidationError(
        'WaitForFundingOrderTask requires a step with fundingOrderId.'
      )
    }
    const orderId = step.fundingOrderId

    const sourceAction = statusManager.findAction(
      step,
      isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )

    const action = statusManager.initializeAction({
      step,
      type: this.actionType,
      chainId:
        this.actionType === 'RECEIVING_CHAIN'
          ? step.action.toChainId
          : step.action.fromChainId,
      status: 'PENDING',
    })

    // initializeAction cannot carry a substatus (ActionProps has no such
    // field), and it leaves an existing action's substatus untouched. Write
    // the sentinel explicitly so the Ethereum wait task's chain-check guard
    // treats this step like a normal bridge on every re-entry.
    statusManager.updateAction(step, action.type, 'PENDING', {
      substatus: 'WAIT_DESTINATION_TRANSACTION',
    })

    const fundingOptions = context.executionOptions as
      | FundingExecutionOptions
      | undefined

    // Annotate: an un-annotated `let` assigned only inside try/catch is an
    // implicit any under strict mode.
    let order: FundingOrder
    try {
      order = await waitForFundingOrder(client, orderId, {
        // Re-reported on every non-terminal poll until the order acknowledges
        // it. One failed report can no longer strand the order.
        txHash: sourceAction?.txHash,
        integrator: fundingOptions?.integrator,
        signal: fundingOptions?.signal,
        onUpdate: (updatedOrder) => {
          // The funding substatus is an open string, so it never reaches
          // ExecutionAction.substatus. The caller gets it here instead.
          fundingOptions?.onOrderUpdate?.(updatedOrder)
        },
        // Enforce the 10s floor - non-terminal reads trigger a backend-side
        // refresh, so polling faster just wastes requests.
        pollingInterval: Math.max(
          fundingOptions?.pollingInterval ??
            context.pollingIntervalMs ??
            10_000,
          10_000
        ),
        timeout: fundingOptions?.timeout,
      })
    } catch (error) {
      // A timeout is not a failure: the order stays PENDING and the UI keeps
      // the resume path alive. Pausing leaves the execution status untouched,
      // where a throw would let BaseStepExecutor mark it FAILED.
      if (error instanceof SDKError && error.code === LiFiErrorCode.Timeout) {
        return { status: 'PAUSED' }
      }
      throw error
    }

    if (order.status === 'FAILED') {
      // Marked, not thrown - the caller resolves with the terminal order.
      statusManager.updateAction(step, action.type, 'FAILED', {
        error: {
          code: LiFiErrorCode.TransactionFailed,
          message: `Funding order ${orderId} failed${
            order.substatus ? ` (${order.substatus})` : ''
          }.`,
        },
      })
      return { status: 'COMPLETED' }
    }

    statusManager.updateAction(step, action.type, 'DONE', {
      chainId: step.action.toChainId,
      // Clear the sentinel. Without this the completed action still reads
      // WAIT_DESTINATION_TRANSACTION and a consumer UI renders "waiting for
      // destination transaction" on a finished step. 'COMPLETED' is a member
      // of the closed SubstatusDone union, so no cast is needed - the order's
      // own open-string substatus still never reaches the action.
      substatus: 'COMPLETED',
      // Object.assign in updateAction copies an explicit undefined, so these
      // two must be absent rather than undefined - otherwise a DONE order
      // without toTxHash erases the source hash from a same-chain SWAP action.
      ...(order.result?.toTxHash && {
        txHash: order.result.toTxHash,
        txLink: `${toChain.metamask.blockExplorerUrls[0]}tx/${order.result.toTxHash}`,
      }),
    })

    statusManager.updateExecution(step, {
      status: 'DONE',
      ...(order.result?.toAmount && { toAmount: order.result.toAmount }),
    })

    return { status: 'COMPLETED' }
  }
}
