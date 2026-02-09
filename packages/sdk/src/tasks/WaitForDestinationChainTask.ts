import type { ExtendedTransactionInfo, FullStatusData } from '@lifi/types'
import { BaseStepExecutionTask } from '../core/BaseStepExecutionTask.js'
import { LiFiErrorCode } from '../errors/constants.js'
import type { ExecutionAction } from '../types/core.js'
import type { TaskContext, TaskExtraBase, TaskResult } from '../types/tasks.js'
import { getTransactionFailedMessage } from '../utils/getTransactionMessage.js'
import { waitForTransactionStatus } from './helpers/waitForTransactionStatus.js'

/**
 * Base task for "wait for destination chain" (bridge only).
 * Uses context.client, step, action, fromChain, toChain, statusManager.
 * Subclasses set `type` and optionally override getWaitOptions() for ecosystem-specific options.
 */
export class WaitForDestinationChainTask<
  TContext extends TaskExtraBase,
> extends BaseStepExecutionTask<TContext> {
  readonly type = 'WAIT_FOR_DESTINATION_CHAIN'
  readonly actionType = 'EXCHANGE'

  override async shouldRun(
    context: TaskContext<TContext>,
    action?: ExecutionAction
  ): Promise<boolean> {
    return context.isTransactionConfirmed(action)
  }

  protected async run(
    context: TaskContext<TContext>,
    action: ExecutionAction
  ): Promise<TaskResult> {
    const {
      client,
      step,
      fromChain,
      toChain,
      statusManager,
      pollingIntervalMs,
    } = context

    // At this point, we should have a txHash or taskId
    // taskId is used for custom integrations that don't use the standard transaction hash
    const transactionHash = action.txHash || action.taskId
    let actionType = action.type
    try {
      // Wait for the transaction status on the destination chain
      if (!transactionHash) {
        throw new Error('Transaction hash is undefined.')
      }

      const isBridgeExecution = fromChain.id !== toChain.id
      if (isBridgeExecution) {
        const receivingChainAction = statusManager.findOrCreateAction({
          step,
          type: 'RECEIVING_CHAIN',
          status: 'PENDING',
          chainId: toChain.id,
        })
        actionType = receivingChainAction.type
      }

      const statusResponse = (await waitForTransactionStatus(
        client,
        statusManager,
        transactionHash,
        step,
        actionType,
        pollingIntervalMs
      )) as FullStatusData

      const statusReceiving =
        statusResponse.receiving as ExtendedTransactionInfo

      // Update action status
      statusManager.updateAction(step, actionType, 'DONE', {
        chainId: statusReceiving?.chainId || toChain.id,
        substatus: statusResponse.substatus,
        substatusMessage: statusResponse.substatusMessage,
        txHash: statusReceiving?.txHash,
        txLink:
          statusReceiving?.txLink ||
          `${toChain.metamask.blockExplorerUrls[0]}tx/${statusReceiving?.txHash}`,
      })

      // Update execution status
      statusManager.updateExecution(step, 'DONE', {
        ...(statusResponse.sending.amount && {
          fromAmount: statusResponse.sending.amount,
        }),
        ...(statusReceiving?.amount && { toAmount: statusReceiving.amount }),
        ...(statusReceiving?.token && { toToken: statusReceiving.token }),
        internalTxLink: statusResponse?.lifiExplorerLink,
        externalTxLink: statusResponse?.bridgeExplorerLink,
        gasCosts: [
          {
            amount: statusResponse.sending.gasAmount,
            amountUSD: statusResponse.sending.gasAmountUSD,
            token: statusResponse.sending.gasToken,
            estimate: statusResponse.sending.gasUsed,
            limit: statusResponse.sending.gasUsed,
            price: statusResponse.sending.gasPrice,
            type: 'SEND',
          },
        ],
      })

      return { status: 'COMPLETED' }
    } catch (e: unknown) {
      // TODO: throw the error that could be parsed by the parseErrors function
      const htmlMessage = await getTransactionFailedMessage(
        client,
        step,
        `${toChain.metamask.blockExplorerUrls[0]}tx/${transactionHash}`
      )

      statusManager.updateAction(step, actionType, 'FAILED', {
        error: {
          code: LiFiErrorCode.TransactionFailed,
          message:
            'Failed while waiting for status of destination chain transaction.',
          htmlMessage,
        },
      })
      throw e
    }
  }
}
