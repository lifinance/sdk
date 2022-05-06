import {
  TransactionReceipt,
  TransactionResponse,
} from '@ethersproject/providers'
import { ExchangeTools, Execution, StatusResponse } from '@lifinance/types'
import { constants } from 'ethers'
import ApiService from '../../services/ApiService'
import ChainsService from '../../services/ChainsService'
import { ExecuteSwapParams } from '../../types'
import { LifiErrorCode, TransactionError } from '../../utils/errors'
import { getProvider } from '../../utils/getProvider'
import { getTransactionFailedMessage, parseError } from '../../utils/parseError'
import { personalizeStep } from '../../utils/utils'
import { checkAllowance } from '../allowance.execute'
import { balanceCheck } from '../balanceCheck.execute'
import { switchChain } from '../switchChain'
import { waitForReceivingTransaction } from '../utils'

export class SwapExecutionManager {
  shouldContinue = true

  setShouldContinue = (val: boolean): void => {
    this.shouldContinue = val
  }

  execute = async ({
    signer,
    step,
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
    const swapProcess = statusManager.findOrCreateProcess('SWAP', step)

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
          throw new TransactionError(
            LifiErrorCode.TransactionUnprepared,
            'Unable to prepare transaction.'
          )
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
        statusManager.updateProcess(step, swapProcess.type, 'ACTION_REQUIRED')
        if (!this.shouldContinue) {
          return step.execution // stop before user interaction is needed
        }

        // -> submit tx
        tx = await signer.sendTransaction(transactionRequest)
      }
    } catch (e) {
      const error = await parseError(e, step, swapProcess)
      statusManager.updateProcess(step, swapProcess.type, 'FAILED', {
        error: {
          message: error.message,
          htmlMessage: error.htmlMessage,
          code: error.code,
        },
      })
      statusManager.updateExecution(step, 'FAILED')
      throw error
    }

    // Wait for Transaction
    statusManager.updateProcess(step, swapProcess.type, 'PENDING', {
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
        statusManager.updateProcess(step, swapProcess.type, 'PENDING', {
          txHash: e.replacement.hash,
          txLink:
            fromChain.metamask.blockExplorerUrls[0] +
            'tx/' +
            e.replacement.hash,
        })
      } else {
        const error = await parseError(e)
        statusManager.updateProcess(step, swapProcess.type, 'FAILED', {
          error: {
            message: error.message,
            htmlMessage: error.htmlMessage,
            code: error.code,
          },
        })
        statusManager.updateExecution(step, 'FAILED')
        throw error
      }
    }

    let statusResponse: StatusResponse
    try {
      if (!swapProcess.txHash) {
        throw new Error('Transaction hash is undefined.')
      }
      statusResponse = await waitForReceivingTransaction(
        step.tool as ExchangeTools,
        fromChain.id,
        fromChain.id,
        swapProcess.txHash
      )
    } catch (e: any) {
      statusManager.updateProcess(step, swapProcess.type, 'FAILED', {
        error: {
          code: LifiErrorCode.TransactionFailed,
          message: 'Failed while waiting for receiving chain.',
          htmlMessage: getTransactionFailedMessage(swapProcess),
        },
      })
      statusManager.updateExecution(step, 'FAILED')
      throw e
    }

    statusManager.updateProcess(step, swapProcess.type, 'DONE', {
      txHash: statusResponse.receiving?.txHash,
      txLink:
        fromChain.metamask.blockExplorerUrls[0] +
        'tx/' +
        statusResponse.receiving?.txHash,
    })

    statusManager.updateExecution(step, 'DONE', {
      fromAmount: statusResponse.sending.amount,
      toAmount: statusResponse.receiving?.amount,
      toToken: statusResponse.receiving?.token,
      // gasUsed: statusResponse.gasUsed,
    })

    // DONE
    return step.execution
  }
}
