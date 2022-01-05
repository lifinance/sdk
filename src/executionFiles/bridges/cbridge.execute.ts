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
    const { currentExecution, updateExecution } =
      statusManager.initExecutionObject(step)
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
          updateExecution,
          currentExecution,
          true
        )
      }
    }

    // STEP 2: Get Transaction ////////////////////////////////////////////////
    const crossProcess = statusManager.createAndPushProcess(
      'crossProcess',
      updateExecution,
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
          crossProcess.errorMessage = 'Unable to prepare Transaction'
          statusManager.setStatusFailed(
            updateExecution,
            currentExecution,
            crossProcess
          )
          throw crossProcess.errorMessage
        }

        // STEP 3: Send Transaction ///////////////////////////////////////////////
        crossProcess.status = 'ACTION_REQUIRED'
        crossProcess.message = 'Sign Transaction'
        updateExecution(currentExecution)
        if (!this.shouldContinue) return currentExecution

        tx = await signer.sendTransaction(transactionRequest)

        // STEP 4: Wait for Transaction ///////////////////////////////////////////
        crossProcess.status = 'PENDING'
        crossProcess.txHash = tx.hash
        crossProcess.txLink =
          fromChain.metamask.blockExplorerUrls[0] + 'tx/' + crossProcess.txHash
        crossProcess.message = 'Wait for'
        updateExecution(currentExecution)
      }

      await tx.wait()
    } catch (e: any) {
      if (e.code === 'TRANSACTION_REPLACED' && e.replacement) {
        crossProcess.txHash = e.replacement.hash
        crossProcess.txLink =
          fromChain.metamask.blockExplorerUrls[0] + 'tx/' + crossProcess.txHash
      } else {
        if (e.message) crossProcess.errorMessage = e.message
        if (e.code) crossProcess.errorCode = e.code
        statusManager.setStatusFailed(
          updateExecution,
          currentExecution,
          crossProcess
        )
        throw e
      }
    }

    crossProcess.message = 'Transfer started: '
    statusManager.setStatusDone(updateExecution, currentExecution, crossProcess)

    // STEP 5: Wait for Receiver //////////////////////////////////////
    const waitForTxProcess = statusManager.createAndPushProcess(
      'waitForTxProcess',
      updateExecution,
      currentExecution,
      'Wait for Receiving Chain'
    )
    let destinationTxReceipt: TransactionReceipt
    try {
      destinationTxReceipt = await cbridge.waitForDestinationChainReceipt(step)
    } catch (e: any) {
      waitForTxProcess.errorMessage = 'Failed waiting'
      if (e.message) waitForTxProcess.errorMessage += ':\n' + e.message
      if (e.code) waitForTxProcess.errorCode = e.code
      statusManager.setStatusFailed(
        updateExecution,
        currentExecution,
        waitForTxProcess
      )
      throw e
    }

    // -> parse receipt & set currentExecution
    // const parsedReceipt = cbridge.parseReceipt(crossProcess.txHash, destinationTxReceipt)
    waitForTxProcess.txHash = destinationTxReceipt.transactionHash
    waitForTxProcess.txLink =
      toChain.metamask.blockExplorerUrls[0] + 'tx/' + waitForTxProcess.txHash
    waitForTxProcess.message = 'Funds Received:'
    // currentExecution.fromAmount = parsedReceipt.fromAmount
    // currentExecution.toAmount = parsedReceipt.toAmount
    // currentExecution.gasUsed = parsedReceipt.gasUsed
    currentExecution.status = 'DONE'
    statusManager.setStatusDone(
      updateExecution,
      currentExecution,
      waitForTxProcess
    )

    // DONE
    return currentExecution
  }
}
