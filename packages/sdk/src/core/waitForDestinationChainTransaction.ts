import type {
  ExtendedChain,
  ExtendedTransactionInfo,
  FullStatusData,
} from '@lifi/types'
import { LiFiErrorCode } from '../errors/constants.js'
import type {
  ExecutionAction,
  LiFiStepExtended,
  SDKClient,
} from '../types/core.js'
import { getTransactionFailedMessage } from '../utils/getTransactionMessage.js'
import type { StatusManager } from './StatusManager.js'
import { waitForTransactionStatus } from './waitForTransactionStatus.js'

export async function waitForDestinationChainTransaction(
  client: SDKClient,
  step: LiFiStepExtended,
  action: ExecutionAction,
  fromChain: ExtendedChain,
  toChain: ExtendedChain,
  statusManager: StatusManager,
  pollingInterval?: number
): Promise<LiFiStepExtended> {
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
    // Record the time when the user has signed the transaction
    step = statusManager.updateExecution(step, 'PENDING', {
      signedAt: Date.now(),
    })

    const statusResponse = (await waitForTransactionStatus(
      client,
      statusManager,
      transactionHash,
      step,
      actionType,
      pollingInterval
    )) as FullStatusData

    const statusReceiving = statusResponse.receiving as ExtendedTransactionInfo

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

    return step
  } catch (e: unknown) {
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
