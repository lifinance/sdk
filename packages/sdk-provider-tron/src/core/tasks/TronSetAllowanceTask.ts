import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
  waitForResult,
} from '@lifi/sdk'
import { callTronRpcsWithRetry } from '../../rpc/callTronRpcsWithRetry.js'
import type { TronStepExecutorContext } from '../../types.js'
import { stripHexPrefix } from '../../utils/stripHexPrefix.js'
import { TRON_POLL_INTERVAL_MS, TRON_POLL_MAX_RETRIES } from '../constants.js'

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
    const feeLimit = approveGasCost?.limit
      ? parseInt(approveGasCost.limit, 10)
      : DEFAULT_APPROVE_FEE_LIMIT

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

        if (!result.result) {
          throw new TransactionError(
            LiFiErrorCode.TransactionFailed,
            `Approval broadcast failed: ${result.code || 'Unknown error'}`
          )
        }

        return result
      }
    )

    const txHash = stripHexPrefix(broadcastResult.transaction.txID)

    statusManager.updateAction(step, action.type, 'PENDING', {
      txHash,
      txLink: `${fromChain.metamask.blockExplorerUrls[0]}#/transaction/${txHash}`,
    })

    // Wait for confirmation
    await waitForResult(
      async () => {
        const txInfo = await callTronRpcsWithRetry(client, (tronWeb) =>
          tronWeb.trx.getTransactionInfo(txHash)
        )
        if (txInfo?.id) {
          if (txInfo.receipt?.result === 'FAILED') {
            throw new TransactionError(
              LiFiErrorCode.TransactionFailed,
              'Approval transaction failed on-chain.'
            )
          }
          return txInfo
        }
        return undefined
      },
      TRON_POLL_INTERVAL_MS,
      TRON_POLL_MAX_RETRIES
    )

    statusManager.updateAction(step, action.type, 'DONE', {
      txHash,
      txLink: `${fromChain.metamask.blockExplorerUrls[0]}#/transaction/${txHash}`,
    })

    return {
      status: 'COMPLETED',
      context: { hasSufficientAllowance: true },
    }
  }
}
