import { TransactionResponse } from '@ethersproject/abstract-provider'
import { constants } from 'ethers'

import Lifi from '../../Lifi'
import { ExecuteCrossParams, getChainById } from '../../types'
import { personalizeStep } from '../../utils'
import { checkAllowance } from '../allowance.execute'
import hop from './hop'

export class HopExecutionManager {
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
        // create new transaction
        const personalizedStep = await personalizeStep(signer, step)
        const { tx: transactionRequest } = await Lifi.getStepTransaction(
          personalizedStep
        )

        // STEP 3: Send Transaction ///////////////////////////////////////////////
        crossProcess.currentExecution = 'ACTION_REQUIRED'
        crossProcess.message = 'Sign Transaction'
        updateExecution(currentExecution)
        if (!this.shouldContinue) return currentExecution

        tx = await signer.sendTransaction(transactionRequest)

        // STEP 4: Wait for Transaction ///////////////////////////////////////////
        crossProcess.currentExecution = 'PENDING'
        crossProcess.txHash = tx.hash
        crossProcess.txLink =
          fromChain.metamask.blockExplorerUrls[0] + 'tx/' + crossProcess.txHash
        crossProcess.message = 'Wait for'
        updateExecution(currentExecution)
      }

      await tx.wait()
    } catch (e: any) {
      if (e.message) crossProcess.errorMessage = e.message
      if (e.code) crossProcess.errorCode = e.code
      statusManager.setStatusFailed(
        updateExecution,
        currentExecution,
        crossProcess
      )
      throw e
    }

    crossProcess.message = 'Transfer started: '
    statusManager.setStatusDone(updateExecution, currentExecution, crossProcess)

    // STEP 5: Wait for Receiver //////////////////////////////////////
    // coinKey should always be set since this data is coming from the Lifi Backend.
    if (!action.toToken.coinKey) {
      console.error("toToken doesn't contain coinKey, aborting")
      throw new Error("toToken doesn't contain coinKey")
    }

    const waitForTxProcess = statusManager.createAndPushProcess(
      'waitForTxProcess',
      updateExecution,
      currentExecution,
      'Wait for Receiving Chain'
    )
    let destinationTxReceipt
    try {
      hop.init(signer, action.fromChainId, action.toChainId)
      destinationTxReceipt = await hop.waitForDestinationChainReceipt(
        crossProcess.txHash,
        action.toToken.coinKey,
        action.fromChainId,
        action.toChainId
      )
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
    const parsedReceipt = hop.parseReceipt(
      crossProcess.txHash,
      destinationTxReceipt
    )
    waitForTxProcess.txHash = destinationTxReceipt.transactionHash
    waitForTxProcess.txLink =
      toChain.metamask.blockExplorerUrls[0] + 'tx/' + waitForTxProcess.txHash
    waitForTxProcess.message = 'Funds Received:'
    currentExecution.fromAmount = parsedReceipt.fromAmount
    currentExecution.toAmount = parsedReceipt.toAmount
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
