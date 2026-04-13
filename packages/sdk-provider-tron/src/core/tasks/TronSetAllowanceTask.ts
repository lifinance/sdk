import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import { callTronRpcsWithRetry } from '../../rpc/callTronRpcsWithRetry.js'
import { waitForTronTxConfirmation } from '../../rpc/waitForTronTxConfirmation.js'
import type { TronStepExecutorContext } from '../../types.js'
import { getTronTxLink } from '../../utils/getTronTxLink.js'
import { stripHexPrefix } from '../../utils/stripHexPrefix.js'

const DEFAULT_APPROVE_FEE_LIMIT = 100_000_000

export class TronSetAllowanceTask extends BaseStepExecutionTask {
  override async shouldRun(context: TronStepExecutorContext): Promise<boolean> {
    return !context.hasSufficientAllowance
  }

  async run(context: TronStepExecutorContext): Promise<TaskResult> {
    const { step, client, wallet, statusManager, fromChain } = context

    const action = statusManager.initializeAction({
      step,
      type: 'SET_ALLOWANCE',
      chainId: step.action.fromChainId,
      status: 'STARTED',
    })

    statusManager.updateAction(step, action.type, 'ACTION_REQUIRED')

    if (!wallet.address) {
      throw new TransactionError(
        LiFiErrorCode.WalletChangedDuringExecution,
        'Wallet address is not available. Wallet may have been disconnected.'
      )
    }

    if (!step.estimate.approvalAddress) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Approval address is not available.'
      )
    }

    const tokenAddress = step.action.fromToken.address
    const spenderAddress = step.estimate.approvalAddress
    const ownerAddress = wallet.address
    const approveAmount = BigInt(step.action.fromAmount).toString()

    const approveGasCost = step.estimate.gasCosts?.find(
      (gc) => gc.type === 'APPROVE'
    )
    const parsedLimit = approveGasCost?.limit ? Number(approveGasCost.limit) : 0
    if (
      approveGasCost?.limit &&
      (!Number.isFinite(parsedLimit) || parsedLimit <= 0)
    ) {
      console.warn(
        '[TronSetAllowanceTask] Invalid fee limit estimate, using default:',
        approveGasCost.limit
      )
    }
    const feeLimit = parsedLimit > 0 ? parsedLimit : DEFAULT_APPROVE_FEE_LIMIT

    const transaction = await callTronRpcsWithRetry(client, async (tronWeb) => {
      const { transaction } =
        await tronWeb.transactionBuilder.triggerSmartContract(
          tokenAddress,
          'approve(address,uint256)',
          { feeLimit },
          [
            { type: 'address', value: spenderAddress },
            { type: 'uint256', value: approveAmount },
          ],
          ownerAddress
        )
      return transaction
    })

    const signedTransaction = await wallet.signTransaction(transaction)

    statusManager.updateAction(step, action.type, 'PENDING')

    const broadcastResult = await callTronRpcsWithRetry(
      client,
      async (tronWeb) => {
        const result = await tronWeb.trx.sendRawTransaction(signedTransaction)

        if (!result.result && String(result.code) !== 'DUP_TRANSACTION_ERROR') {
          throw new TransactionError(
            LiFiErrorCode.TransactionFailed,
            `Approval broadcast failed: ${result.code || 'Unknown error'}`
          )
        }

        return result
      }
    )

    // DUP_TRANSACTION_ERROR responses omit the `transaction` field — fall back
    // to the txID computed locally from the signed transaction in that case.
    const txHash = stripHexPrefix(
      broadcastResult.transaction?.txID ?? signedTransaction.txID
    )

    statusManager.updateAction(step, action.type, 'PENDING', {
      txHash,
      txLink: getTronTxLink(fromChain, txHash),
    })

    await waitForTronTxConfirmation(
      client,
      txHash,
      'Approval transaction failed on-chain.'
    )

    statusManager.updateAction(step, action.type, 'DONE', {
      txHash,
      txLink: getTronTxLink(fromChain, txHash),
    })

    return {
      status: 'COMPLETED',
      context: { hasSufficientAllowance: true },
    }
  }
}
