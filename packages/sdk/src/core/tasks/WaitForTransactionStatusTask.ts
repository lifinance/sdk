import type { ExtendedTransactionInfo, FullStatusData } from '@lifi/types'
import { LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError } from '../../errors/errors.js'
import type { ExecutionActionType } from '../../types/core.js'
import type { StepExecutorContext, TaskResult } from '../../types/execution.js'
import { getTransactionFailedMessage } from '../../utils/getTransactionMessage.js'
import { BaseStepExecutionTask } from '../BaseStepExecutionTask.js'
import { waitForTransactionStatus } from './helpers/waitForTransactionStatus.js'

export class WaitForTransactionStatusTask extends BaseStepExecutionTask {
  static override readonly name = 'WAIT_FOR_TRANSACTION_STATUS' as const
  override readonly taskName = WaitForTransactionStatusTask.name

  readonly actionType: ExecutionActionType

  constructor(actionType: ExecutionActionType) {
    super()
    this.actionType = actionType
  }

  async run(context: StepExecutorContext): Promise<TaskResult> {
    const {
      client,
      step,
      statusManager,
      pollingIntervalMs,
      toChain,
      isBridgeExecution,
      transactionStatusObservers,
    } = context

    // At this point, we should have a txHash or taskId
    // taskId is used for custom integrations that don't use the standard transaction hash
    let transactionHash: string | undefined
    try {
      const swapOrBridgeAction = statusManager.findAction(
        step,
        isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
      )
      transactionHash = swapOrBridgeAction?.txHash || swapOrBridgeAction?.taskId

      // Wait for the transaction status on the destination chain
      if (!transactionHash) {
        throw new Error('Transaction hash is undefined.')
      }

      const action = statusManager.findOrCreateAction({
        step,
        type: this.actionType,
        chainId:
          this.actionType === 'RECEIVING_CHAIN'
            ? step.action.toChainId
            : step.action.fromChainId,
        status: 'PENDING',
      })

      const statusResponse = (await waitForTransactionStatus(
        client,
        statusManager,
        transactionHash,
        step,
        action.type,
        pollingIntervalMs,
        transactionStatusObservers
      )) as FullStatusData

      const statusReceiving =
        statusResponse.receiving as ExtendedTransactionInfo

      // Update action status
      statusManager.updateAction(step, action.type, 'DONE', {
        chainId: statusReceiving?.chainId || toChain.id,
        substatus: statusResponse.substatus,
        substatusMessage: statusResponse.substatusMessage,
        txHash: statusReceiving?.txHash,
        txLink:
          statusReceiving?.txLink ||
          `${toChain.metamask.blockExplorerUrls[0]}tx/${statusReceiving?.txHash}`,
      })

      // Update execution status
      statusManager.updateExecution(step, {
        status: 'DONE',
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
    } catch (e: any) {
      const htmlMessage = await getTransactionFailedMessage(
        client,
        step,
        `${toChain.metamask.blockExplorerUrls[0]}tx/${transactionHash}`
      )
      throw new TransactionError(
        LiFiErrorCode.TransactionFailed,
        htmlMessage ??
          'Failed while waiting for status of destination chain transaction.',
        e
      )
    }
  }
}
