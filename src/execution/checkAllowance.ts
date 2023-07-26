import type { Address, Hash, WalletClient } from 'viem'
import { publicActions } from 'viem'
import { getAllowance, setAllowance } from '../allowance'
import { MaxUint256 } from '../constants'
import type { StatusManager } from '../execution/StatusManager'
import type {
  Chain,
  InternalExecutionSettings,
  LifiStep,
  Process,
  ProcessType,
} from '../types'
import { parseError } from '../utils/parseError'

export const checkAllowance = async (
  walletClient: WalletClient,
  step: LifiStep,
  statusManager: StatusManager,
  settings: InternalExecutionSettings,
  chain: Chain,
  allowUserInteraction = false,
  shouldBatchTransactions = false
): Promise<Hash | void> => {
  // Ask the user to set an allowance
  let allowanceProcess: Process = statusManager.findOrCreateProcess(
    step,
    'TOKEN_ALLOWANCE'
  )

  // Check allowance
  try {
    if (allowanceProcess.txHash && allowanceProcess.status !== 'DONE') {
      await waitForApprovalTransaction(
        walletClient,
        allowanceProcess.txHash! as Address,
        allowanceProcess.type,
        step,
        chain,
        statusManager
      )
    } else {
      const approved = await getAllowance(
        chain.id,
        step.action.fromToken.address,
        walletClient.account!.address,
        step.estimate.approvalAddress
      )

      const fromAmount = BigInt(step.action.fromAmount)

      if (fromAmount > approved) {
        if (!allowUserInteraction) {
          return
        }
        const approvalAmount = settings.infiniteApproval
          ? MaxUint256
          : fromAmount

        if (shouldBatchTransactions) {
          const approveTxHash = await setAllowance(
            walletClient,
            step.action.fromToken.address,
            step.estimate.approvalAddress,
            approvalAmount,
            true
          )

          allowanceProcess = statusManager.updateProcess(
            step,
            allowanceProcess.type,
            'DONE'
          )

          return approveTxHash
        }

        const approveTxHash = await setAllowance(
          walletClient,
          step.action.fromToken.address,
          step.estimate.approvalAddress,
          approvalAmount
        )
        await waitForApprovalTransaction(
          walletClient,
          approveTxHash,
          allowanceProcess.type,
          step,
          chain,
          statusManager
        )
      } else {
        allowanceProcess = statusManager.updateProcess(
          step,
          allowanceProcess.type,
          'DONE'
        )
      }
    }
  } catch (e: any) {
    const error = await parseError(e, step, allowanceProcess)
    allowanceProcess = statusManager.updateProcess(
      step,
      allowanceProcess.type,
      'FAILED',
      {
        error: {
          message: error.message,
          htmlMessage: error.htmlMessage,
          code: error.code,
        },
      }
    )
    statusManager.updateExecution(step, 'FAILED')
    throw error
  }
}

const waitForApprovalTransaction = async (
  walletClient: WalletClient,
  txHash: Hash,
  processType: ProcessType,
  step: LifiStep,
  chain: Chain,
  statusManager: StatusManager
) => {
  const client = walletClient.extend(publicActions)
  statusManager.updateProcess(step, processType, 'PENDING', {
    txHash,
    txLink: `${chain.metamask.blockExplorerUrls[0]}tx/${txHash}`,
  })

  const transactionReceipt = await client.waitForTransactionReceipt({
    hash: txHash,
    onReplaced(response) {
      statusManager.updateProcess(step, processType, 'PENDING', {
        txHash: response.transaction.hash,
        txLink: `${chain.metamask.blockExplorerUrls[0]}tx/${response.transaction.hash}`,
      })
    },
  })

  statusManager.updateProcess(step, processType, 'DONE', {
    txHash: transactionReceipt.transactionHash,
    txLink: `${chain.metamask.blockExplorerUrls[0]}tx/${transactionReceipt.transactionHash}`,
  })
}
