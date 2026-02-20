import {
  BaseStepExecutionTask,
  type ExecutionAction,
  isTransactionPending,
  type TaskResult,
} from '@lifi/sdk'
import type { Address } from 'viem'
import { waitForTransactionReceipt } from '../../actions/waitForTransactionReceipt.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { getTxLink } from './helpers/getTxLink.js'

export class EthereumWaitForApprovalTransactionTask extends BaseStepExecutionTask {
  override async shouldRun(
    _context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<boolean> {
    return isTransactionPending(action)
  }

  async run(
    context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<TaskResult> {
    const {
      client,
      step,
      statusManager,
      getExecutionStrategy,
      checkClient,
      fromChain,
    } = context

    const strategy = await getExecutionStrategy(step)
    const batchingSupported = strategy === 'batch'

    if (!batchingSupported) {
      const updatedClient = await checkClient(step, action)
      if (!updatedClient) {
        return { status: 'PAUSED' }
      }

      statusManager.updateAction(step, action.type, 'PENDING')

      const txHash = action.txHash as Address

      const transactionReceipt = await waitForTransactionReceipt(client, {
        client: updatedClient,
        chainId: fromChain.id,
        txHash,
        onReplaced(response) {
          const newHash = response.transaction.hash
          statusManager.updateAction(step, action.type, 'PENDING', {
            txHash: newHash,
            txLink: getTxLink(fromChain, newHash),
          })
        },
      })

      const finalHash = transactionReceipt?.transactionHash || txHash
      statusManager.updateAction(step, action.type, action.status, {
        txHash: finalHash,
        txLink: getTxLink(fromChain, finalHash),
      })
    }

    statusManager.updateAction(step, action.type, 'DONE')

    return {
      status: 'COMPLETED',
    }
  }
}
