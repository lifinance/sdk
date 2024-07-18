import type { Chain, LiFiStep, Process, ProcessType } from '@lifi/types'
import type { Address, Hash, WalletClient } from 'viem'
import { maxUint256 } from 'viem'
import { parseEVMErrors } from './parseEVMErrors.js'
import type { StatusManager } from '../StatusManager.js'
import type { ExecutionOptions } from '../types.js'
import { getAllowance } from './getAllowance.js'
import { setAllowance } from './setAllowance.js'
import { waitForTransactionReceipt } from './waitForTransactionReceipt.js'

export const checkAllowance = async (
  chain: Chain,
  step: LiFiStep,
  walletClient: WalletClient,
  statusManager: StatusManager,
  settings?: ExecutionOptions,
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
      allowanceProcess = statusManager.updateProcess(
        step,
        allowanceProcess.type,
        'STARTED'
      )

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
        const approvalAmount = settings?.infiniteApproval
          ? maxUint256
          : fromAmount

        if (shouldBatchTransactions) {
          const approveTxHash = await setAllowance(
            walletClient,
            step.action.fromToken.address,
            step.estimate.approvalAddress,
            approvalAmount,
            settings,
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
    const error = await parseEVMErrors(e, step, allowanceProcess)
    allowanceProcess = statusManager.updateProcess(
      step,
      allowanceProcess.type,
      'FAILED',
      {
        error: {
          message: error.cause.message,
          htmlMessage: error.cause.htmlMessage,
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
  step: LiFiStep,
  chain: Chain,
  statusManager: StatusManager
) => {
  statusManager.updateProcess(step, processType, 'PENDING', {
    txHash,
    txLink: `${chain.metamask.blockExplorerUrls[0]}tx/${txHash}`,
  })

  const transactionReceipt = await waitForTransactionReceipt({
    walletClient,
    chainId: chain.id,
    txHash: txHash,
    onReplaced(response) {
      statusManager.updateProcess(step, processType, 'PENDING', {
        txHash: response.transaction.hash,
        txLink: `${chain.metamask.blockExplorerUrls[0]}tx/${response.transaction.hash}`,
      })
    },
  })

  const transactionHash = transactionReceipt?.transactionHash || txHash
  statusManager.updateProcess(step, processType, 'DONE', {
    txHash: transactionHash,
    txLink: `${chain.metamask.blockExplorerUrls[0]}tx/${transactionHash}`,
  })
}
