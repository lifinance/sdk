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
          statusManager.updateProcess(swapProcess, 'FAILED', {
            errorMessage: 'Unable to prepare Transaction',
          })
          statusManager.updateExecution(step, 'FAILED')
          throw swapProcess.errorMessage
        }

        // -> set currentExecution
        // swapProcess.status = 'ACTION_REQUIRED'
        // swapProcess.message = `Sign Transaction`
        statusManager.updateProcess(swapProcess, 'ACTION_REQUIRED', {
          message: 'Sign Transaction',
        })
        if (!this.shouldContinue) return currentExecution // stop before user interaction is needed

        // -> submit tx
        tx = await signer.sendTransaction(transactionRequest)
      }
    } catch (e: any) {
      // -> set currentExecution
      // if (e.message) swapProcess.errorMessage = e.message
      // if (e.code) swapProcess.errorCode = e.code
      // statusManager.setProcessFailed(step, currentExecution, swapProcess)
      statusManager.updateProcess(swapProcess, 'FAILED', {
        errorMessage: e.message,
        errorCode: e.code,
      })
      statusManager.updateExecution(step, 'FAILED')
      throw e
    }

    // Wait for Transaction
    // -> set currentExecution
    // swapProcess.status = 'PENDING'
    // swapProcess.txHash = tx.hash
    // swapProcess.txLink =
    //   fromChain.metamask.blockExplorerUrls[0] + 'tx/' + swapProcess.txHash
    // swapProcess.message = `Swapping - Wait for`
    // updateExecution(currentExecution)

    statusManager.updateProcess(swapProcess, 'PENDING', {
      message: 'Swapping - Wait for',
      txLink: fromChain.metamask.blockExplorerUrls[0] + 'tx/' + tx.hash,
      txHash: tx.hash,
    })

    // -> waiting
    let receipt: TransactionReceipt
    try {
      receipt = await tx.wait()
    } catch (e: any) {
      // -> set status
      if (e.code === 'TRANSACTION_REPLACED' && e.replacement) {
        receipt = e.replacement
        statusManager.updateProcess(swapProcess, 'PENDING', {
          txHash: e.replacement.hash,
          txLink:
            fromChain.metamask.blockExplorerUrls[0] +
            'tx/' +
            e.replacement.hash,
        })
      } else {
        statusManager.updateProcess(swapProcess, 'FAILED', {
          errorMessage: e.message,
          errorCode: e.code,
        })
        statusManager.updateExecution(step, 'FAILED')
        throw e
      }
    }

    // -> set status
    const parsedReceipt = await parseReceipt(tx, receipt)

    // currentExecution.gasUsed = parsedReceipt.gasUsed
    statusManager.updateProcess(swapProcess, 'DONE', { message: 'Swapped:' })

    statusManager.updateExecution(step, 'DONE', {
      fromAmount: parsedReceipt.fromAmount,
      toAmount: parsedReceipt.toAmount,
    })

    // DONE
    return currentExecution
  }
}
