import {
  TransactionReceipt,
  TransactionResponse,
} from '@ethersproject/providers'
import { constants } from 'ethers'
import { parseWalletError } from '../../utils/parseError'

import { ExecuteSwapParams } from '../../types'
import { personalizeStep } from '../../utils/utils'
import { checkAllowance } from '../allowance.execute'
import { balanceCheck } from '../balanceCheck.execute'
import { Execution } from '@lifinance/types'
import { getProvider } from '../../utils/getProvider'
import { switchChain } from '../switchChain'
import ChainsService from '../../services/ChainsService'
import ApiService from '../../services/ApiService'

export class SwapExecutionManager {
  shouldContinue = true

  setShouldContinue = (val: boolean): void => {
    this.shouldContinue = val
  }

  execute = async ({
    signer,
    step,
    parseReceipt,
    statusManager,
    settings,
  }: ExecuteSwapParams): Promise<Execution> => {
    // setup

    const { action, estimate } = step
    step.execution = statusManager.initExecutionObject(step)

    const chainsService = ChainsService.getInstance()
    const fromChain = await chainsService.getChainById(action.fromChainId)

    // Approval
    if (action.fromToken.address !== constants.AddressZero) {
      await checkAllowance(
        signer,
        step,
        fromChain,
        action.fromToken,
        action.fromAmount,
        estimate.approvalAddress,
        statusManager,
        settings.infiniteApproval,
        this.shouldContinue
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
        tx = await getProvider(signer).getTransaction(swapProcess.txHash)
      } else {
        // -> check balance
        await balanceCheck(signer, step)

        // -> get tx from backend
        const personalizedStep = await personalizeStep(signer, step)
        const { transactionRequest } = await ApiService.getStepTransaction(
          personalizedStep
        )
        if (!transactionRequest) {
          statusManager.updateProcess(step, swapProcess.id, 'FAILED', {
            errorMessage: 'Unable to prepare Transaction',
          })
          statusManager.updateExecution(step, 'FAILED')
          throw swapProcess.errorMessage
        }

        // make sure that chain is still correct
        const updatedSigner = await switchChain(
          signer,
          statusManager,
          step,
          settings.switchChainHook,
          this.shouldContinue
        )

        if (!updatedSigner) {
          // chain switch was not successful, stop execution here
          return step.execution
        }

        signer = updatedSigner

        // -> set step.execution
        statusManager.updateProcess(step, swapProcess.id, 'ACTION_REQUIRED', {
          message: 'Sign Transaction',
        })
        if (!this.shouldContinue) return step.execution // stop before user interaction is needed

        // -> submit tx
        tx = await signer.sendTransaction(transactionRequest)
      }
    } catch (e) {
      const error = await parseWalletError(e, step, swapProcess)
      statusManager.updateProcess(step, swapProcess.id, 'FAILED', {
        errorMessage: error.message,
        htmlErrorMessage: error.htmlMessage,
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
        const error = await parseWalletError(e)
        statusManager.updateProcess(step, swapProcess.id, 'FAILED', {
          errorMessage: error.message,
          htmlErrorMessage: error.htmlMessage,
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
