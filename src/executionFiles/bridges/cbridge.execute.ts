import {
  TransactionReceipt,
  TransactionResponse,
} from '@ethersproject/abstract-provider'
import { constants } from 'ethers'

import Lifi from '../../Lifi'
import {
  createAndPushProcess,
  initStatus,
  setStatusDone,
  setStatusFailed,
} from '../../status'
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

  execute = async ({ signer, step, updateStatus }: ExecuteCrossParams) => {
    const { action, execution, estimate } = step
    const { status, update } = initStatus(updateStatus, execution)
    const fromChain = getChainById(action.fromChainId)
    const toChain = getChainById(action.toChainId)

    // STEP 1: Check Allowance ////////////////////////////////////////////////
    // approval still needed?
    const oldCrossProcess = status.process.find((p) => p.id === 'crossProcess')
    if (!oldCrossProcess || !oldCrossProcess.txHash) {
      if (action.fromToken.address !== constants.AddressZero) {
        // Check Token Approval only if fromToken is not the native token => no approval needed in that case
        if (!this.shouldContinue) return status
        await checkAllowance(
          signer,
          fromChain,
          action.fromToken,
          action.fromAmount,
          estimate.approvalAddress,
          update,
          status,
          true
        )
      }
    }

    // STEP 2: Get Transaction ////////////////////////////////////////////////
    const crossProcess = createAndPushProcess(
      'crossProcess',
      update,
      status,
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
        const updatedStep = await Lifi.getStepTransaction(personalizedStep)
        // update step
        Object.assign(step, updatedStep)

        if (!step.transactionRequest) {
          crossProcess.errorMessage = 'Unable to prepare Transaction'
          setStatusFailed(update, status, crossProcess)
          throw crossProcess.errorMessage
        }

        // STEP 3: Send Transaction ///////////////////////////////////////////////
        crossProcess.status = 'ACTION_REQUIRED'
        crossProcess.message = 'Sign Transaction'
        update(status)
        if (!this.shouldContinue) return status

        tx = await signer.sendTransaction(step.transactionRequest)

        // STEP 4: Wait for Transaction ///////////////////////////////////////////
        crossProcess.status = 'PENDING'
        crossProcess.txHash = tx.hash
        crossProcess.txLink =
          fromChain.metamask.blockExplorerUrls[0] + 'tx/' + crossProcess.txHash
        crossProcess.message = 'Wait for'
        update(status)
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
        setStatusFailed(update, status, crossProcess)
        throw e
      }
    }

    crossProcess.message = 'Transfer started: '
    setStatusDone(update, status, crossProcess)

    // STEP 5: Wait for Receiver //////////////////////////////////////
    const waitForTxProcess = createAndPushProcess(
      'waitForTxProcess',
      update,
      status,
      'Wait for Receiving Chain'
    )
    let destinationTx: TransactionResponse
    let destinationTxReceipt: TransactionReceipt
    try {
      const claimed = await cbridge.waitForDestinationChainReceipt(step)
      destinationTx = claimed.tx
      destinationTxReceipt = claimed.receipt
    } catch (e: any) {
      waitForTxProcess.errorMessage = 'Failed waiting'
      if (e.message) waitForTxProcess.errorMessage += ':\n' + e.message
      if (e.code) waitForTxProcess.errorCode = e.code
      setStatusFailed(update, status, waitForTxProcess)
      throw e
    }

    // -> parse receipt & set status
    const parsedReceipt = cbridge.parseReceipt(
      await signer.getAddress(),
      action.toToken.address,
      destinationTx,
      destinationTxReceipt
    )
    waitForTxProcess.txHash = destinationTxReceipt.transactionHash
    waitForTxProcess.txLink =
      toChain.metamask.blockExplorerUrls[0] + 'tx/' + waitForTxProcess.txHash
    waitForTxProcess.message = 'Funds Received:'
    status.fromAmount = step.action.fromAmount
    status.toAmount = parsedReceipt.toAmount
    // status.gasUsed = parsedReceipt.gasUsed
    status.status = 'DONE'
    setStatusDone(update, status, waitForTxProcess)

    // DONE
    return status
  }
}
