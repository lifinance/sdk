/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { TransactionRequest } from '@ethersproject/abstract-provider'
import BigNumber from 'bignumber.js'
import { constants, ContractTransaction, Signer } from 'ethers'
import { getApproved, setApproval } from '../allowance/utils'
import { StatusManager } from '../execution/StatusManager'
import { Chain, InternalExecutionSettings, Process, Step } from '../types'
import { getProvider } from '../utils/getProvider'
import { parseError } from '../utils/parseError'

export const checkAllowance = async (
  signer: Signer,
  step: Step,
  statusManager: StatusManager,
  settings: InternalExecutionSettings,
  chain: Chain,
  allowUserInteraction = false,
  configCallback?: (tx: TransactionRequest) => Promise<TransactionRequest>
): Promise<void> => {
  // Ask the user to set an allowance

  let allowanceProcess: Process = statusManager.findOrCreateProcess(
    step,
    'TOKEN_ALLOWANCE'
  )

  // Check allowance
  try {
    if (allowanceProcess.txHash && allowanceProcess.status !== 'DONE') {
      if (allowanceProcess.status !== 'PENDING') {
        allowanceProcess = statusManager.updateProcess(
          step,
          allowanceProcess.type,
          'PENDING'
        )
      }
      await getProvider(signer).waitForTransaction(allowanceProcess.txHash!)
      allowanceProcess = statusManager.updateProcess(
        step,
        allowanceProcess.type,
        'DONE'
      )
    } else {
      const approvalRequest: TransactionRequest = {
        from: step.action.fromToken.address,
        to: step.estimate.approvalAddress,
      }

      if (configCallback) {
        const config = await configCallback(approvalRequest)

        approvalRequest.gasLimit = config.gasLimit
        approvalRequest.gasPrice = config.gasPrice
      }

      if (!approvalRequest.from) {
        throw new Error('Missing Signer address')
      }

      if (!approvalRequest.to) {
        throw new Error('Missing ERC20 contract address')
      }

      const approved = await getApproved(
        signer,
        approvalRequest.from,
        approvalRequest.to,
        approvalRequest
      )

      if (new BigNumber(step.action.fromAmount).gt(approved)) {
        if (!allowUserInteraction) {
          return
        }
        const approvalAmount = settings.infiniteApproval
          ? constants.MaxUint256.toString()
          : step.action.fromAmount
        const approveTx = await setApproval(
          signer,
          step.action.fromToken.address,
          step.estimate.approvalAddress,
          approvalAmount
        )

        allowanceProcess = statusManager.updateProcess(
          step,
          allowanceProcess.type,
          'PENDING',
          {
            txHash: approveTx.hash,
            txLink:
              chain.metamask.blockExplorerUrls[0] + 'tx/' + approveTx.hash,
          }
        )

        // Wait for the transcation
        await approveTx.wait()

        allowanceProcess = statusManager.updateProcess(
          step,
          allowanceProcess.type,
          'DONE'
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
    if (e.code === 'TRANSACTION_REPLACED' && e.replacement) {
      await transactionReplaced(
        e.replacement,
        allowanceProcess,
        step,
        chain,
        statusManager
      )
    } else {
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
}

const transactionReplaced = async (
  replacementTx: ContractTransaction,
  allowanceProcess: Process,
  step: Step,
  chain: Chain,
  statusManager: StatusManager
) => {
  try {
    allowanceProcess = statusManager.updateProcess(
      step,
      allowanceProcess.type,
      'PENDING',
      {
        txHash: replacementTx.hash,
        txLink:
          chain.metamask.blockExplorerUrls[0] + 'tx/' + replacementTx.hash,
      }
    )
    await replacementTx.wait()
    allowanceProcess = statusManager.updateProcess(
      step,
      allowanceProcess.type,
      'DONE'
    )
  } catch (e: any) {
    if (e.code === 'TRANSACTION_REPLACED' && e.replacement) {
      await transactionReplaced(
        e.replacement,
        allowanceProcess,
        step,
        chain,
        statusManager
      )
    }
    throw e
  }
}
