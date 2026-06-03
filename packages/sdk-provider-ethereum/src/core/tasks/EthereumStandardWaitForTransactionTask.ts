import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { Hash } from 'viem'
import { waitForTransactionReceipt } from '../../actions/waitForTransactionReceipt.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { updateActionWithReceipt } from './helpers/updateActionWithReceipt.js'

export class EthereumStandardWaitForTransactionTask extends BaseStepExecutionTask {
  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
    const {
      client,
      step,
      statusManager,
      fromChain,
      isBridgeExecution,
      checkClient,
    } = context

    const action = statusManager.findAction(
      step,
      isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )
    if (!action) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Action not found.'
      )
    }

    const updatedClient = await checkClient(step)
    if (!updatedClient) {
      return { status: 'PAUSED' }
    }

    const transactionReceipt = await waitForTransactionReceipt(client, {
      client: updatedClient,
      chainId: fromChain.id,
      txHash: action.txHash as Hash,
      onReplaced: (response) => {
        statusManager.updateAction(step, action.type, 'PENDING', {
          txHash: response.transaction.hash,
          txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${response.transaction.hash}`,
        })
      },
    })

    updateActionWithReceipt(
      statusManager,
      step,
      fromChain,
      transactionReceipt,
      action
    )

    if (isBridgeExecution) {
      statusManager.updateAction(step, action.type, 'DONE')
    }

    return { status: 'COMPLETED' }
  }
}
