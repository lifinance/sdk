import type {
  ExtendedChain,
  ExtendedTransactionInfo,
  FullStatusData,
} from '@lifi/types'
import { LiFiErrorCode } from '../errors/constants.js'
import type {
  ExecutionActionType,
  LiFiStepExtended,
  SDKClient,
  StepExecutionType,
} from '../types/core.js'
import { getTransactionFailedMessage } from '../utils/getTransactionMessage.js'
import type { StatusManager } from './StatusManager.js'
import { waitForTransactionStatus } from './waitForTransactionStatus.js'

export async function waitForDestinationChainTransaction(
  client: SDKClient,
  step: LiFiStepExtended,
  type: StepExecutionType,
  fromChain: ExtendedChain,
  toChain: ExtendedChain,
  statusManager: StatusManager,
  pollingInterval?: number
): Promise<LiFiStepExtended> {
  const transaction = step.execution?.actions.find((t) => t.type === type)
  // At this point, we should have a txHash or taskId
  // taskId is used for custom integrations that don't use the standard transaction hash
  const transactionHash = transaction?.txHash || transaction?.taskId
  try {
    // Wait for the transaction status on the destination chain
    if (!transactionHash) {
      throw new Error('Transaction hash is undefined.')
    }

    const isBridgeExecution = fromChain.id !== toChain.id
    if (isBridgeExecution) {
      step = statusManager.updateExecution(step, {
        type: 'RECEIVING_CHAIN',
        status: 'PENDING',
      })
      type = 'RECEIVING_CHAIN'
    }

    const statusResponse = (await waitForTransactionStatus(
      client,
      statusManager,
      transactionHash,
      step,
      type,
      pollingInterval
    )) as FullStatusData

    const statusReceiving = statusResponse.receiving as ExtendedTransactionInfo

    // Update execution status
    step = statusManager.updateExecution(step, {
      type,
      status: 'DONE',
      substatus: statusResponse.substatus,
      substatusMessage: statusResponse.substatusMessage,
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
      action: {
        type: type as ExecutionActionType,
        chainId: statusReceiving?.chainId || toChain.id,
        txHash: statusReceiving?.txHash,
        txLink:
          statusReceiving?.txLink ||
          `${toChain.metamask.blockExplorerUrls[0]}tx/${statusReceiving?.txHash}`,
        isDone: true,
      },
    })

    return step
  } catch (e: unknown) {
    const htmlMessage = await getTransactionFailedMessage(
      client,
      step,
      `${toChain.metamask.blockExplorerUrls[0]}tx/${transactionHash}`
    )

    step = statusManager.updateExecution(step, {
      type,
      status: 'FAILED',
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
