import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { Address } from 'viem'
import { waitForTransactionReceipt } from '../../actions/waitForTransactionReceipt.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { getTxLink } from './helpers/getTxLink.js'

export class EthereumWaitForApprovalTransactionTask extends BaseStepExecutionTask {
  static override readonly name =
    'ETHEREUM_WAIT_FOR_APPROVAL_TRANSACTION' as const
  override readonly taskName = EthereumWaitForApprovalTransactionTask.name

  override async shouldRun(
    context: EthereumStepExecutorContext
  ): Promise<boolean> {
    const { step, statusManager } = context
    const allowanceAction = statusManager.findAction(step, 'SET_ALLOWANCE')
    return !!allowanceAction?.txHash && allowanceAction?.status !== 'DONE'
  }

  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
    const {
      client,
      step,
      statusManager,
      getExecutionStrategy,
      checkClient,
      fromChain,
    } = context

    const action = statusManager.findAction(step, 'SET_ALLOWANCE')
    if (!action?.txHash) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. No transaction hash found.'
      )
    }

    const strategy = await getExecutionStrategy(step)
    const batchingSupported = strategy === 'batched'

    if (!batchingSupported) {
      const updatedClient = await checkClient(step)
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
