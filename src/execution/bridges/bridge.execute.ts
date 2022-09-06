import { TransactionResponse } from '@ethersproject/abstract-provider'
import { Execution, StatusResponse } from '@lifi/types'
import ApiService from '../../services/ApiService'
import ChainsService from '../../services/ChainsService'
import { ExecuteCrossParams } from '../../types'
import { LifiErrorCode, TransactionError } from '../../utils/errors'
import { getProvider } from '../../utils/getProvider'
import { getTransactionFailedMessage, parseError } from '../../utils/parseError'
import { isZeroAddress, personalizeStep } from '../../utils/utils'
import { checkAllowance } from '../allowance.execute'
import { balanceCheck } from '../balanceCheck.execute'
import { stepComparison } from '../stepComparison'
import { switchChain } from '../switchChain'
import { getSubstatusMessage, waitForReceivingTransaction } from '../utils'

export class BridgeExecutionManager {
  allowUserInteraction = true

  allowInteraction = (value: boolean): void => {
    this.allowUserInteraction = value
  }

  execute = async ({
    signer,
    step,
    statusManager,
    settings,
  }: ExecuteCrossParams): Promise<Execution> => {
    step.execution = statusManager.initExecutionObject(step)

    const chainsService = ChainsService.getInstance()
    const fromChain = await chainsService.getChainById(step.action.fromChainId)
    const toChain = await chainsService.getChainById(step.action.toChainId)

    // STEP 1: Check allowance
    const oldCrossProcess = step.execution.process.find(
      (p) => p.type === 'CROSS_CHAIN'
    )
    // Check token approval only if fromToken is not the native token => no approval needed in that case
    if (
      !oldCrossProcess?.txHash &&
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
    let crossChainProcess = statusManager.findOrCreateProcess(
      step,
      'CROSS_CHAIN'
    )

    if (crossChainProcess.status !== 'DONE') {
      try {
        let transaction: TransactionResponse
        if (crossChainProcess.txHash) {
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
            crossChainProcess.txHash
          )
        } else {
          crossChainProcess = statusManager.updateProcess(
            step,
            crossChainProcess.type,
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

          crossChainProcess = statusManager.updateProcess(
            step,
            crossChainProcess.type,
            'ACTION_REQUIRED'
          )

          if (!this.allowUserInteraction) {
            return step.execution!
          }

          // Submit the transaction
          transaction = await signer.sendTransaction(transactionRequest)

          // STEP 4: Wait for the transaction
          crossChainProcess = statusManager.updateProcess(
            step,
            crossChainProcess.type,
            'PENDING',
            {
              txHash: transaction.hash,
              txLink:
                fromChain.metamask.blockExplorerUrls[0] +
                'tx/' +
                transaction.hash,
            }
          )
        }

        await transaction.wait()

        crossChainProcess = statusManager.updateProcess(
          step,
          crossChainProcess.type,
          'DONE'
        )
      } catch (e: any) {
        if (e.code === 'TRANSACTION_REPLACED' && e.replacement) {
          crossChainProcess = statusManager.updateProcess(
            step,
            crossChainProcess.type,
            'DONE',
            {
              txHash: e.replacement.hash,
              txLink:
                fromChain.metamask.blockExplorerUrls[0] +
                'tx/' +
                e.replacement.hash,
            }
          )
        } else {
          const error = await parseError(e, step, crossChainProcess)
          crossChainProcess = statusManager.updateProcess(
            step,
            crossChainProcess.type,
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

    // STEP 5: Wait for the receiving chain
    let receivingChainProcess = statusManager.findOrCreateProcess(
      step,
      'RECEIVING_CHAIN',
      'PENDING'
    )
    let statusResponse: StatusResponse
    try {
      if (!crossChainProcess.txHash) {
        throw new Error('Transaction hash is undefined.')
      }
      statusResponse = await waitForReceivingTransaction(
        crossChainProcess.txHash,
        statusManager,
        receivingChainProcess.type,
        step
      )
      receivingChainProcess = statusManager.updateProcess(
        step,
        receivingChainProcess.type,
        'DONE',
        {
          substatus: statusResponse.substatus,
          substatusMessage:
            statusResponse.substatusMessage ||
            getSubstatusMessage(
              statusResponse.status,
              statusResponse.substatus
            ),
          txHash: statusResponse.receiving?.txHash,
          txLink:
            toChain.metamask.blockExplorerUrls[0] +
            'tx/' +
            statusResponse.receiving?.txHash,
        }
      )

      statusManager.updateExecution(step, 'DONE', {
        fromAmount: statusResponse.sending.amount,
        toAmount: statusResponse.receiving?.amount,
        toToken: statusResponse.receiving?.token,
        gasUsed: statusResponse.sending.gasUsed,
        gasPrice: statusResponse.sending.gasPrice,
      })
    } catch (e: any) {
      receivingChainProcess = statusManager.updateProcess(
        step,
        receivingChainProcess.type,
        'FAILED',
        {
          error: {
            code: LifiErrorCode.TransactionFailed,
            message: 'Failed while waiting for receiving chain.',
            htmlMessage: getTransactionFailedMessage(
              step,
              crossChainProcess.txLink
            ),
          },
        }
      )
      statusManager.updateExecution(step, 'FAILED')
      console.warn(e)
      throw e
    }

    // DONE
    return step.execution!
  }
}
