import { TransactionResponse } from '@ethersproject/abstract-provider'
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
import anyswap from './anyswap'

export class AnySwapExecutionManager {
  shouldContinue = true

  setShouldContinue = (val: boolean) => {
    this.shouldContinue = val
  }

  execute = async ({ signer, step, updateStatus }: ExecuteCrossParams) => {
    const { action, execution, estimate } = step
    const { status, updateStepWithStatus } = initStatus(step)
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
          updateStepWithStatus,
          status,
          true
        )
      }
    }

    // STEP 2: Get Transaction ////////////////////////////////////////////////
    const crossProcess = createAndPushProcess(
      'crossProcess',
      updateStepWithStatus,
      status,
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
        crossProcess.status = 'ACTION_REQUIRED'
        crossProcess.message = 'Sign Transaction'
        updateStepWithStatus(status)
        if (!this.shouldContinue) return status // stop before user action is required

        tx = await signer.sendTransaction(transactionRequest)

        // STEP 4: Wait for Transaction ///////////////////////////////////////////
        crossProcess.status = 'PENDING'
        crossProcess.txHash = tx.hash
        crossProcess.txLink =
          fromChain.metamask.blockExplorerUrls[0] + 'tx/' + crossProcess.txHash
        crossProcess.message = 'Wait for'
        updateStepWithStatus(status)
      }

      await tx.wait()
    } catch (e: any) {
      if (e.message) crossProcess.errorMessage = e.message
      if (e.code) crossProcess.errorCode = e.code
      setStatusFailed(updateStepWithStatus, status, crossProcess)
      throw e
    }

    crossProcess.message = 'Transfer started: '
    setStatusDone(updateStepWithStatus, status, crossProcess)

    // STEP 5: Wait for Receiver //////////////////////////////////////
    const waitForTxProcess = createAndPushProcess(
      'waitForTxProcess',
      updateStepWithStatus,
      status,
      'Wait for Receiving Chain'
    )
    let destinationTxReceipt
    try {
      destinationTxReceipt = await anyswap.waitForDestinationChainReceipt(
        crossProcess.txHash,
        toChain.id
      )
    } catch (e: any) {
      waitForTxProcess.errorMessage = 'Failed waiting'
      if (e.message) waitForTxProcess.errorMessage += ':\n' + e.message
      if (e.code) waitForTxProcess.errorCode = e.code
      setStatusFailed(updateStepWithStatus, status, waitForTxProcess)
      throw e
    }

    // -> parse receipt & set status
    const parsedReceipt = anyswap.parseReceipt(
      crossProcess.txHash,
      destinationTxReceipt
    )
    waitForTxProcess.txHash = destinationTxReceipt.transactionHash
    waitForTxProcess.txLink =
      toChain.metamask.blockExplorerUrls[0] + 'tx/' + waitForTxProcess.txHash
    waitForTxProcess.message = 'Funds Received:'
    status.fromAmount = parsedReceipt.fromAmount
    status.toAmount = parsedReceipt.toAmount
    // status.gasUsed = parsedReceipt.gasUsed
    status.status = 'DONE'
    setStatusDone(updateStepWithStatus, status, waitForTxProcess)

    // DONE
    return status
  }
}
