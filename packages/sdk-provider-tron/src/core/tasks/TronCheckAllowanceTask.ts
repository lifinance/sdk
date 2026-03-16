import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import { callTronRpcsWithRetry } from '../../rpc/callTronRpcsWithRetry.js'
import type { TronStepExecutorContext } from '../../types.js'

export class TronCheckAllowanceTask extends BaseStepExecutionTask {
  override async shouldRun(context: TronStepExecutorContext): Promise<boolean> {
    return !context.hasSufficientAllowance
  }

  async run(context: TronStepExecutorContext): Promise<TaskResult> {
    const { step, client, wallet, statusManager } = context

    const action = statusManager.initializeAction({
      step,
      type: 'CHECK_ALLOWANCE',
      chainId: step.action.fromChainId,
      status: 'STARTED',
    })

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

    const ownerAddress = wallet.address
    const tokenAddress = step.action.fromToken.address
    const spenderAddress = step.estimate.approvalAddress
    const fromAmount = BigInt(step.action.fromAmount)

    const allowance = await callTronRpcsWithRetry(client, async (tronWeb) => {
      const contract = await tronWeb.contract().at(tokenAddress)
      const result = await contract
        .allowance(ownerAddress, spenderAddress)
        .call({ from: ownerAddress })
      return BigInt(result.toString())
    })

    statusManager.updateAction(step, action.type, 'DONE')

    return {
      status: 'COMPLETED',
      context: {
        hasSufficientAllowance: fromAmount <= allowance,
      },
    }
  }
}
