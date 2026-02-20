import {
  BaseStepExecutionTask,
  type ExecutionAction,
  isTransactionPrepared,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { Address, Hash, Hex } from 'viem'
import { sendCalls } from 'viem/actions'
import { getAction } from 'viem/utils'
import type { Call, EthereumStepExecutorContext } from '../../types.js'

export class EthereumBatchedSignAndExecuteTask extends BaseStepExecutionTask {
  override async shouldRun(
    _context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<boolean> {
    return isTransactionPrepared(action)
  }

  async run(
    context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<TaskResult> {
    const { step, fromChain, statusManager, checkClient, transactionRequest } =
      context

    const calls = []

    const tokenAllowanceAction = statusManager.findAction(
      step,
      'TOKEN_ALLOWANCE'
    )
    const resetTxHash = tokenAllowanceAction?.resetTxHash as Address
    const txHash = tokenAllowanceAction?.txHash as Address

    if (resetTxHash) {
      calls.push({
        to: step.action.fromToken.address as Address,
        data: resetTxHash,
        chainId: step.action.fromToken.chainId,
      })
    }

    if (txHash) {
      calls.push({
        to: step.action.fromToken.address as Address,
        data: txHash,
        chainId: step.action.fromToken.chainId,
      })
    }

    // Make sure that the chain is still correct
    const updatedClient = await checkClient(step, action)
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
    })

    statusManager.updateExecution(step, {
      status: 'PENDING',
      signedAt: Date.now(),
    })

    return { status: 'COMPLETED' }
  }
}
