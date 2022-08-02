import { TransactionResponse } from '@ethersproject/abstract-provider'
import { Execution, StatusResponse } from '@lifi/types'
import { constants } from 'ethers'
import ApiService from '../../services/ApiService'
import ChainsService from '../../services/ChainsService'
import { ExecuteCrossParams } from '../../types'
import { LifiErrorCode, TransactionError } from '../../utils/errors'
import { getProvider } from '../../utils/getProvider'
import { getTransactionFailedMessage, parseError } from '../../utils/parseError'
import { personalizeStep } from '../../utils/utils'
import { checkAllowance } from '../allowance.execute'
import { balanceCheck } from '../balanceCheck.execute'
import { stepComparison } from '../stepComparison'
import { switchChain } from '../switchChain'
import { getSubstatusMessage, waitForReceivingTransaction } from '../utils'

export class BridgeExecutionManager {
  shouldContinue = true

  setShouldContinue = (val: boolean): void => {
    this.shouldContinue = val
  }

  execute = async ({
    signer,
    step,
    statusManager,
    settings,
  }: ExecuteCrossParams): Promise<Execution> => {
    const { action, estimate } = step
    step.execution = statusManager.initExecutionObject(step)

    const chainsService = ChainsService.getInstance()
    const fromChain = await chainsService.getChainById(action.fromChainId)
    const toChain = await chainsService.getChainById(action.toChainId)

    // STEP 1: Check Allowance ////////////////////////////////////////////////
    // approval still needed?
    const oldCrossProcess = step.execution.process.find(
      (p) => p.type === 'CROSS_CHAIN'
    )
    if (!oldCrossProcess?.txHash) {
      if (action.fromToken.address !== constants.AddressZero) {
        // Check Token Approval only if fromToken is not the native token => no approval needed in that case
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
    }

    // STEP 2: Get Transaction ////////////////////////////////////////////////
    const crossChainProcess = statusManager.findOrCreateProcess(
      'CROSS_CHAIN',
      step
    )

    try {
      let tx: TransactionResponse
      if (crossChainProcess.txHash) {
        // load exiting transaction
        tx = await getProvider(signer).getTransaction(crossChainProcess.txHash)
      } else {
        // check balance
        await balanceCheck(signer, step)

        // create new transaction
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
            this.shouldContinue
          )),
          execution: step.execution,
        }

        const { transactionRequest } = step

        if (!transactionRequest) {
          throw new TransactionError(
            LifiErrorCode.TransactionUnprepared,
            'Unable to prepare transaction.'
          )
        }

        // STEP 3: Send Transaction ///////////////////////////////////////////////
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
          return step.execution!
        }

        signer = updatedSigner

        statusManager.updateProcess(
          step,
          crossChainProcess.type,
          'ACTION_REQUIRED'
        )
        if (!this.shouldContinue) {
          return step.execution!
        }

        tx = await signer.sendTransaction(transactionRequest)

        // STEP 4: Wait for Transaction ///////////////////////////////////////////
        statusManager.updateProcess(step, crossChainProcess.type, 'PENDING', {
          txHash: tx.hash,
          txLink: fromChain.metamask.blockExplorerUrls[0] + 'tx/' + tx.hash,
        })
      }

      await tx.wait()
    } catch (e: any) {
      if (e.code === 'TRANSACTION_REPLACED' && e.replacement) {
        statusManager.updateProcess(step, crossChainProcess.type, 'PENDING', {
          txHash: e.replacement.hash,
          txLink:
            fromChain.metamask.blockExplorerUrls[0] +
            'tx/' +
            e.replacement.hash,
        })
      } else {
        const error = await parseError(e, step, crossChainProcess)
        statusManager.updateProcess(step, crossChainProcess.type, 'FAILED', {
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

    statusManager.updateProcess(step, crossChainProcess.type, 'DONE')

    // STEP 5: Wait for Receiver //////////////////////////////////////
    const receivingChainProcess = statusManager.findOrCreateProcess(
      'RECEIVING_CHAIN',
      step,
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
    } catch (e: any) {
      statusManager.updateProcess(step, receivingChainProcess.type, 'FAILED', {
        error: {
          code: LifiErrorCode.TransactionFailed,
          message: 'Failed while waiting for receiving chain.',
          htmlMessage: getTransactionFailedMessage(
            step,
            crossChainProcess.txLink
          ),
        },
      })
      statusManager.updateExecution(step, 'FAILED')
      throw e
    }

    statusManager.updateProcess(step, receivingChainProcess.type, 'DONE', {
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
      gasUsed: statusResponse.sending.gasUsed,
      gasPrice: statusResponse.sending.gasPrice,
    })

    // DONE
    return step.execution!
  }
}
