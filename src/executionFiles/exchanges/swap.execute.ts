import {
  TransactionReceipt,
  TransactionResponse,
} from '@ethersproject/providers'
import { constants } from 'ethers'
import { parseWalletError } from '../../utils/parseError'

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
    step.execution = statusManager.initExecutionObject(step)

    // Approval
    if (action.fromToken.address !== constants.AddressZero) {
      if (!this.shouldContinue) return step.execution
      await checkAllowance(
        signer,
        step,
        fromChain,
        action.fromToken,
        action.fromAmount,
        estimate.approvalAddress,
        statusManager,
        true
      )
    }

    // Start Swap
    // -> set step.execution
    const swapProcess = statusManager.findOrCreateProcess(
      'swapProcess',
      step,
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
          statusManager.updateProcess(step, swapProcess.id, 'FAILED', {
            errorMessage: 'Unable to prepare Transaction',
          })
          statusManager.updateExecution(step, 'FAILED')
          throw swapProcess.errorMessage
        }

        // -> set step.execution
        // swapProcess.status = 'ACTION_REQUIRED'
        // swapProcess.message = `Sign Transaction`
        statusManager.updateProcess(step, swapProcess.id, 'ACTION_REQUIRED', {
          message: 'Sign Transaction',
        })
        if (!this.shouldContinue) return step.execution // stop before user interaction is needed

        // -> submit tx
        tx = await signer.sendTransaction(transactionRequest)
      }
    } catch (e) {
      const error = parseWalletError(e)
      statusManager.updateProcess(step, swapProcess.id, 'FAILED', {
        errorMessage: error.message,
        errorCode: error.code,
      })
      statusManager.updateExecution(step, 'FAILED')
      throw error
    }

    // Wait for Transaction
    statusManager.updateProcess(step, swapProcess.id, 'PENDING', {
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
        statusManager.updateProcess(step, swapProcess.id, 'PENDING', {
          txHash: e.replacement.hash,
          txLink:
            fromChain.metamask.blockExplorerUrls[0] +
            'tx/' +
            e.replacement.hash,
        })
      } else {
        const error = parseWalletError(e)
        statusManager.updateProcess(step, swapProcess.id, 'FAILED', {
          errorMessage: error.message,
          errorCode: error.code,
        })
        statusManager.updateExecution(step, 'FAILED')
        throw error
      }
    }

    // -> set status
    const parsedReceipt = await parseReceipt(tx, receipt)

    // step.execution.gasUsed = parsedReceipt.gasUsed
    statusManager.updateProcess(step, swapProcess.id, 'DONE', {
      message: 'Swapped:',
    })

    statusManager.updateExecution(step, 'DONE', {
      fromAmount: parsedReceipt.fromAmount,
      toAmount: parsedReceipt.toAmount,
    })

    // DONE
    return step.execution
  }
}
