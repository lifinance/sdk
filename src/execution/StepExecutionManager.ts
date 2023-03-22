/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { TransactionResponse } from '@ethersproject/abstract-provider'
import { Execution, StatusResponse } from '@lifi/types'
import { checkAllowance } from '../allowance'
import { checkBalance } from '../balance'
import ApiService from '../services/ApiService'
import ChainsService from '../services/ChainsService'
import { ExecutionParams } from '../types'
import { LifiErrorCode, TransactionError } from '../utils/errors'
import { getProvider } from '../utils/getProvider'
import { getTransactionFailedMessage, parseError } from '../utils/parseError'
import { isZeroAddress, personalizeStep } from '../utils/utils'
import { stepComparison } from './stepComparison'
import { switchChain } from './switchChain'
import { getSubstatusMessage, waitForReceivingTransaction } from './utils'
import { TransactionRequest } from '@ethersproject/abstract-provider'

export class StepExecutionManager {
  allowUserInteraction = true

  allowInteraction = (value: boolean): void => {
    this.allowUserInteraction = value
  }

  execute = async ({
    signer,
    step,
    statusManager,
    settings,
    updateTransactionRequest,
  }: ExecutionParams): Promise<Execution> => {
    step.execution = statusManager.initExecutionObject(step)

    const chainsService = ChainsService.getInstance()
    const fromChain = await chainsService.getChainById(step.action.fromChainId)
    const toChain = await chainsService.getChainById(step.action.toChainId)

    const isBridgeExecution = fromChain.id !== toChain.id
    const currentProcessType = isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'

    // STEP 1: Check allowance
    const existingProcess = step.execution.process.find(
      (p) => p.type === currentProcessType
    )
    // Check token approval only if fromToken is not the native token => no approval needed in that case
    if (
      !existingProcess?.txHash &&
      !isZeroAddress(step.action.fromToken.address)
    ) {
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
    let process = statusManager.findOrCreateProcess(step, currentProcessType)

    if (process.status !== 'DONE') {
      try {
        let transaction: TransactionResponse
        if (process.txHash) {
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
            return step.execution
          }

          signer = updatedSigner

          // Load exiting transaction
          transaction = await getProvider(signer).getTransaction(process.txHash)
        } else {
          process = statusManager.updateProcess(step, process.type, 'STARTED')

          // Check balance
          await checkBalance(signer, step)

          // Create new transaction
          if (!step.transactionRequest) {
            const personalizedStep = await personalizeStep(signer, step)
            const updatedStep = await ApiService.getStepTransaction(
              personalizedStep
            )
            const comparedStep = await stepComparison(
              statusManager,
              personalizedStep,
              updatedStep,
              settings,
              this.allowUserInteraction
            )
            step = {
              ...comparedStep,
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

          process = statusManager.updateProcess(
            step,
            process.type,
            'ACTION_REQUIRED'
          )

          if (!this.allowUserInteraction) {
            return step.execution!
          }

          if (updateTransactionRequest) {
            const customConfig: TransactionRequest =
              await updateTransactionRequest(transactionRequest)

            transactionRequest.gasLimit = customConfig.gasLimit
            transactionRequest.gasPrice = customConfig.gasPrice
            transactionRequest.maxPriorityFeePerGas =
              customConfig.maxPriorityFeePerGas
            transactionRequest.maxFeePerGas = customConfig.maxFeePerGas
          }

          // Submit the transaction
          transaction = await signer.sendTransaction(transactionRequest)

          // STEP 4: Wait for the transaction
          process = statusManager.updateProcess(step, process.type, 'PENDING', {
            txHash: transaction.hash,
            txLink:
              fromChain.metamask.blockExplorerUrls[0] +
              'tx/' +
              transaction.hash,
          })
        }

        await transaction.wait()

        process = statusManager.updateProcess(step, process.type, 'PENDING', {
          txHash: transaction.hash,
          txLink:
            fromChain.metamask.blockExplorerUrls[0] + 'tx/' + transaction.hash,
        })

        if (isBridgeExecution) {
          process = statusManager.updateProcess(step, process.type, 'DONE')
        }
      } catch (e: any) {
        if (e.code === 'TRANSACTION_REPLACED' && e.replacement) {
          process = statusManager.updateProcess(step, process.type, 'DONE', {
            txHash: e.replacement.hash,
            txLink:
              fromChain.metamask.blockExplorerUrls[0] +
              'tx/' +
              e.replacement.hash,
          })
        } else {
          const error = await parseError(e, step, process)
          process = statusManager.updateProcess(step, process.type, 'FAILED', {
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
    }

    // STEP 5: Wait for the receiving chain
    const processTxHash = process.txHash
    if (isBridgeExecution) {
      process = statusManager.findOrCreateProcess(
        step,
        'RECEIVING_CHAIN',
        'PENDING'
      )
    }
    let statusResponse: StatusResponse
    try {
      if (!processTxHash) {
        throw new Error('Transaction hash is undefined.')
      }
      statusResponse = await waitForReceivingTransaction(
        processTxHash,
        statusManager,
        process.type,
        step
      )
      process = statusManager.updateProcess(step, process.type, 'DONE', {
        substatus: statusResponse.substatus,
        substatusMessage:
          statusResponse.substatusMessage ||
          getSubstatusMessage(statusResponse.status, statusResponse.substatus),
        txHash: statusResponse.receiving?.txHash,
        txLink:
          toChain.metamask.blockExplorerUrls[0] +
          'tx/' +
          statusResponse.receiving?.txHash,
      })

      statusManager.updateExecution(step, 'DONE', {
        fromAmount: statusResponse.sending.amount,
        toAmount: statusResponse.receiving?.amount,
        toToken: statusResponse.receiving?.token,
        gasAmount: statusResponse.sending.gasAmount,
        gasAmountUSD: statusResponse.sending.gasAmountUSD,
        gasPrice: statusResponse.sending.gasPrice,
        gasToken: statusResponse.sending.gasToken,
        gasUsed: statusResponse.sending.gasUsed,
      })
    } catch (e: unknown) {
      const htmlMessage = await getTransactionFailedMessage(
        step,
        process.txLink
      )

      process = statusManager.updateProcess(step, process.type, 'FAILED', {
        error: {
          code: LifiErrorCode.TransactionFailed,
          message: 'Failed while waiting for receiving chain.',
          htmlMessage,
        },
      })
      statusManager.updateExecution(step, 'FAILED')
      console.warn(e)
      throw e
    }

    // DONE
    return step.execution!
  }
}
