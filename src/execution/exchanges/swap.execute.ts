import { TransactionResponse } from '@ethersproject/providers'
import { Execution, StatusResponse } from '@lifi/types'
import ApiService from '../../services/ApiService'
import ChainsService from '../../services/ChainsService'
import { ExecuteSwapParams } from '../../types'
import { LifiErrorCode, TransactionError } from '../../utils/errors'
import { getProvider } from '../../utils/getProvider'
import { getTransactionFailedMessage, parseError } from '../../utils/parseError'
import { isZeroAddress, personalizeStep } from '../../utils/utils'
import { checkAllowance } from '../allowance.execute'
import { balanceCheck } from '../balanceCheck.execute'
import { stepComparison } from '../stepComparison'
import { switchChain } from '../switchChain'
import { waitForReceivingTransaction } from '../utils'

export class SwapExecutionManager {
  allowUserInteraction = true

  allowInteraction = (value: boolean): void => {
    this.allowUserInteraction = value
  }

  execute = async ({
    signer,
    step,
    statusManager,
    settings,
  }: ExecuteSwapParams): Promise<Execution> => {
    step.execution = statusManager.initExecutionObject(step)

    const chainsService = ChainsService.getInstance()
    const fromChain = await chainsService.getChainById(step.action.fromChainId)

    // STEP 1: Check allowance
    if (!isZeroAddress(step.action.fromToken.address)) {
      await checkAllowance(
        signer,
        step,
        statusManager,
        settings,
        fromChain,
        this.allowUserInteraction
      )
    }

    // STEP 2: Get transaction
    let swapProcess = statusManager.findOrCreateProcess(step, 'SWAP')

    let transaction: TransactionResponse
    try {
      if (swapProcess.txHash) {
        // Make sure that the chain is still correct
        const updatedSigner = await switchChain(
          signer,
          statusManager,
          step,
          settings.switchChainHook,
          this.allowUserInteraction
        )

        if (!updatedSigner) {
          // Chain switch was not successful, stop execution here
          return step.execution!
        }

        signer = updatedSigner
        // Load exiting transaction
        transaction = await getProvider(signer).getTransaction(
          swapProcess.txHash
        )
      } else {
        swapProcess = statusManager.updateProcess(
          step,
          swapProcess.type,
          'STARTED'
        )

        // Check balance
        await balanceCheck(signer, step)

        // Create new transaction
        if (!step.transactionRequest) {
          const personalizedStep = await personalizeStep(signer, step)
          const updatedStep = await ApiService.getStepTransaction(
            personalizedStep
          )
          step = {
            ...(await stepComparison(
              statusManager,
              personalizedStep,
              updatedStep,
              settings.acceptSlippageUpdateHook,
              this.allowUserInteraction
            )),
            execution: step.execution,
          }
        }

        const { transactionRequest } = step
        if (!transactionRequest) {
          throw new TransactionError(
            LifiErrorCode.TransactionUnprepared,
            'Unable to prepare transaction.'
          )
        }

        // STEP 3: Send the transaction
        // Make sure that the chain is still correct
        const updatedSigner = await switchChain(
          signer,
          statusManager,
          step,
          settings.switchChainHook,
          this.allowUserInteraction
        )

        if (!updatedSigner) {
          // Chain switch was not successful, stop execution here
          return step.execution!
        }

        signer = updatedSigner

        swapProcess = statusManager.updateProcess(
          step,
          swapProcess.type,
          'ACTION_REQUIRED'
        )

        if (!this.allowUserInteraction) {
          return step.execution!
        }

        // Submit the transaction
        transaction = await signer.sendTransaction(transactionRequest)
      }

      // STEP 4: Wait for the transaction
      swapProcess = statusManager.updateProcess(
        step,
        swapProcess.type,
        'PENDING',
        {
          txLink:
            fromChain.metamask.blockExplorerUrls[0] + 'tx/' + transaction.hash,
          txHash: transaction.hash,
        }
      )

      await transaction.wait()
    } catch (e: any) {
      if (e.code === 'TRANSACTION_REPLACED' && e.replacement) {
        swapProcess = statusManager.updateProcess(
          step,
          swapProcess.type,
          'PENDING',
          {
            txHash: e.replacement.hash,
            txLink:
              fromChain.metamask.blockExplorerUrls[0] +
              'tx/' +
              e.replacement.hash,
          }
        )
      } else {
        const error = await parseError(e)
        swapProcess = statusManager.updateProcess(
          step,
          swapProcess.type,
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

    // STEP 5: Wait for the receiving chain
    let statusResponse: StatusResponse
    try {
      if (!swapProcess.txHash) {
        throw new Error('Transaction hash is undefined.')
      }
      statusResponse = await waitForReceivingTransaction(
        swapProcess.txHash,
        statusManager,
        swapProcess.type,
        step
      )
    } catch (e: any) {
      swapProcess = statusManager.updateProcess(
        step,
        swapProcess.type,
        'FAILED',
        {
          error: {
            code: LifiErrorCode.TransactionFailed,
            message: 'Failed while waiting for receiving chain.',
            htmlMessage: getTransactionFailedMessage(step, swapProcess.txLink),
          },
        }
      )
      statusManager.updateExecution(step, 'FAILED')
      throw e
    }

    swapProcess = statusManager.updateProcess(step, swapProcess.type, 'DONE', {
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
      gasUsed: statusResponse.sending.gasUsed,
      gasPrice: statusResponse.sending.gasPrice,
    })

    // DONE
    return step.execution!
  }
}
