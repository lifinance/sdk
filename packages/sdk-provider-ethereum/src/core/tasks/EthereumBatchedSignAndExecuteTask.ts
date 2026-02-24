import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { Address, Hash, Hex } from 'viem'
import { sendCalls } from 'viem/actions'
import { getAction } from 'viem/utils'
import type { Call, EthereumStepExecutorContext } from '../../types.js'

export class EthereumBatchedSignAndExecuteTask extends BaseStepExecutionTask {
  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
    const {
      step,
      fromChain,
      statusManager,
      checkClient,
      tasksResults,
      isBridgeExecution,
    } = context

    const transactionRequest = tasksResults.transactionRequest

    const calls = [...tasksResults.calls]

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

    // Make sure that the chain is still correct
    const updatedClient = await checkClient(step)
    if (!updatedClient) {
      return { status: 'PAUSED' }
    }

    if (!transactionRequest) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Transaction request is not found.'
      )
    }

    const transferCall: Call = {
      chainId: fromChain.id,
      data: transactionRequest.data as Hex,
      to: transactionRequest.to as Address,
      value: transactionRequest.value,
    }

    calls.push(transferCall)

    const { id } = await getAction(
      updatedClient,
      sendCalls,
      'sendCalls'
    )({
      account: updatedClient.account!,
      calls,
    })

    statusManager.updateAction(step, action.type, 'PENDING', {
      taskId: id as Hash,
      txType: 'batched',
      signedAt: Date.now(),
    })

    return { status: 'COMPLETED', result: { calls } }
  }
}
