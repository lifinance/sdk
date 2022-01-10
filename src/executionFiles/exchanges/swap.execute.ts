import {
  TransactionReceipt,
  TransactionResponse,
} from '@ethersproject/providers'
import { constants } from 'ethers'

import Lifi from '../../Lifi'

import { ExecuteSwapParams, getChainById } from '../../types'
import { personalizeStep } from '../../utils'
import { checkAllowance } from '../allowance.execute'
import { balanceCheck } from '../balanceCheck.execute'

export class SwapExecutionManager {
  shouldContinue = true

  setShouldContinue = (val: boolean) => {
    this.shouldContinue = val
  }

  execute = async ({
    signer,
    step,
    parseReceipt,
    statusManager,
  }: ExecuteSwapParams) => {
    // setup
    const { action, estimate } = step
    const fromChain = getChainById(action.fromChainId)
    const currentExecution = statusManager.initExecutionObject(step)

    // Approval
    if (action.fromToken.address !== constants.AddressZero) {
      if (!this.shouldContinue) return currentExecution
      await checkAllowance(
        signer,
        step,
        fromChain,
        action.fromToken,
        action.fromAmount,
        estimate.approvalAddress,
        statusManager,
        updateExecution,
        currentExecution,
        true
      )
    }

    // Start Swap
    // -> set currentExecution
    const swapProcess = statusManager.findOrCreateProcess(
      'swapProcess',
      step,
      currentExecution,
      'Preparing Swap'
    )

    // -> swapping
    let tx: TransactionResponse
    try {
      if (swapProcess.txHash) {
        // -> restore existing tx
        tx = await signer.provider!.getTransaction(swapProcess.txHash)
      } else {
        // -> check balance
        await balanceCheck(signer, step)

        // -> get tx from backend
        const personalizedStep = await personalizeStep(signer, step)
        const { transactionRequest } = await Lifi.getStepTransaction(
          personalizedStep
        )
        if (!transactionRequest) {
          swapProcess.errorMessage = 'Unable to prepare Transaction'
          statusManager.setProcessFailed(step, currentExecution, swapProcess)
          throw swapProcess.errorMessage
        }

        // -> set currentExecution
        swapProcess.status = 'ACTION_REQUIRED'
        swapProcess.message = `Sign Transaction`
        updateExecution(currentExecution)
        if (!this.shouldContinue) return currentExecution // stop before user interaction is needed

        // -> submit tx
        tx = await signer.sendTransaction(transactionRequest)
      }
    } catch (e: any) {
      // -> set currentExecution
      if (e.message) swapProcess.errorMessage = e.message
      if (e.code) swapProcess.errorCode = e.code
      statusManager.setProcessFailed(step, currentExecution, swapProcess)
      throw e
    }

    // Wait for Transaction
    // -> set currentExecution
    swapProcess.status = 'PENDING'
    swapProcess.txHash = tx.hash
    swapProcess.txLink =
      fromChain.metamask.blockExplorerUrls[0] + 'tx/' + swapProcess.txHash
    swapProcess.message = `Swapping - Wait for`
    updateExecution(currentExecution)

    // -> waiting
    let receipt: TransactionReceipt
    try {
      receipt = await tx.wait()
    } catch (e: any) {
      // -> set status
      if (e.code === 'TRANSACTION_REPLACED' && e.replacement) {
        swapProcess.txHash = e.replacement.hash
        swapProcess.txLink =
          fromChain.metamask.blockExplorerUrls[0] + 'tx/' + swapProcess.txHash
        receipt = e.replacement
      } else {
        if (e.message) swapProcess.errorMessage = e.message
        if (e.code) swapProcess.errorCode = e.code
        statusManager.setProcessFailed(step, currentExecution, swapProcess)
        throw e
      }
    }

    // -> set status
    const parsedReceipt = await parseReceipt(tx, receipt)
    swapProcess.message = 'Swapped:'
    currentExecution.fromAmount = parsedReceipt.fromAmount
    currentExecution.toAmount = parsedReceipt.toAmount
    // currentExecution.gasUsed = parsedReceipt.gasUsed
    currentExecution.status = 'DONE'
    statusManager.setProcessDone(step, currentExecution, swapProcess)

    // DONE
    return currentExecution
  }
}
