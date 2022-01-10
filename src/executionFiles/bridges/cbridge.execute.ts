import {
  TransactionReceipt,
  TransactionResponse,
} from '@ethersproject/abstract-provider'
import { constants } from 'ethers'

import Lifi from '../../Lifi'
import { ExecuteCrossParams, getChainById } from '../../types'
import { personalizeStep } from '../../utils'
import { checkAllowance } from '../allowance.execute'
import { balanceCheck } from '../balanceCheck.execute'
import cbridge from './cbridge'

export class CbridgeExecutionManager {
  shouldContinue = true

  setShouldContinue = (val: boolean) => {
    this.shouldContinue = val
  }

  execute = async ({ signer, step, statusManager }: ExecuteCrossParams) => {
    const { action, estimate } = step
    const currentExecution = statusManager.initExecutionObject(step)
    const fromChain = getChainById(action.fromChainId)
    const toChain = getChainById(action.toChainId)

    // STEP 1: Check Allowance ////////////////////////////////////////////////
    // approval still needed?
    const oldCrossProcess = currentExecution.process.find(
      (p) => p.id === 'crossProcess'
    )
    if (!oldCrossProcess || !oldCrossProcess.txHash) {
      if (action.fromToken.address !== constants.AddressZero) {
        // Check Token Approval only if fromToken is not the native token => no approval needed in that case
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
    }

    // STEP 2: Get Transaction ////////////////////////////////////////////////
    const crossProcess = statusManager.findOrCreateProcess(
      'crossProcess',
      step,
      currentExecution,
      'Prepare Transaction'
    )

    try {
      let tx: TransactionResponse
      if (crossProcess.txHash) {
        // load exiting transaction
        tx = await signer.provider!.getTransaction(crossProcess.txHash)
      } else {
        // check balance
        await balanceCheck(signer, step)

        // create new transaction
        const personalizedStep = await personalizeStep(signer, step)
        const { transactionRequest } = await Lifi.getStepTransaction(
          personalizedStep
        )
        if (!transactionRequest) {
          statusManager.updateProcess(crossProcess, 'FAILED', {
            errorMessage: 'Unable to prepare Transaction',
          })
          throw crossProcess.errorMessage
        }

        // STEP 3: Send Transaction ///////////////////////////////////////////////

        statusManager.updateProcess(crossProcess, 'ACTION_REQUIRED')

        if (!this.shouldContinue) return currentExecution

        tx = await signer.sendTransaction(transactionRequest)

        // STEP 4: Wait for Transaction ///////////////////////////////////////////
        statusManager.updateProcess(crossProcess, 'PENDING', {
          txHash: tx.hash,
          txLink: fromChain.metamask.blockExplorerUrls[0] + 'tx/' + tx.hash,
        })
      }

      await tx.wait()
    } catch (e: any) {
      if (e.code === 'TRANSACTION_REPLACED' && e.replacement) {
        statusManager.updateProcess(crossProcess, 'PENDING', {
          txHash: e.replacement.hash,
          txLink:
            fromChain.metamask.blockExplorerUrls[0] +
            'tx/' +
            e.replacement.hash,
        })
      } else {
        if (e.message) crossProcess.errorMessage = e.message
        if (e.code) crossProcess.errorCode = e.code
        statusManager.updateProcess(crossProcess, 'PENDING', {
          errorMessage: e.message,
          errorCode: e.code,
        })
        throw e
      }
    }

    statusManager.updateProcess(crossProcess, 'DONE', {
      message: 'Transfer started: ',
    })

    // STEP 5: Wait for Receiver //////////////////////////////////////
    const waitForTxProcess = statusManager.findOrCreateProcess(
      'waitForTxProcess',
      step,
      currentExecution,
      'Wait for Receiving Chain'
    )
    let destinationTxReceipt: TransactionReceipt
    try {
      destinationTxReceipt = await cbridge.waitForDestinationChainReceipt(step)
    } catch (e: any) {
      // waitForTxProcess.errorMessage = 'Failed waiting'
      // if (e.message) waitForTxProcess.errorMessage += ':\n' + e.message
      // if (e.code) waitForTxProcess.errorCode = e.code

      statusManager.updateProcess(waitForTxProcess, 'FAILED', {
        errorMessage: 'Failed waiting',
        errorCode: e.code,
      })

      throw e
    }

    // -> parse receipt & set currentExecution
    // const parsedReceipt = cbridge.parseReceipt(crossProcess.txHash, destinationTxReceipt)

    // currentExecution.fromAmount = parsedReceipt.fromAmount
    // currentExecution.toAmount = parsedReceipt.toAmount
    // currentExecution.gasUsed = parsedReceipt.gasUsed

    statusManager.updateProcess(waitForTxProcess, 'DONE', {
      message: 'Funds Received:',
      txHash: destinationTxReceipt.transactionHash,
      txLink:
        toChain.metamask.blockExplorerUrls[0] +
        'tx/' +
        destinationTxReceipt.transactionHash,
    })
    statusManager.updateExecution(step, 'DONE')

    // DONE
    return currentExecution
  }
}
