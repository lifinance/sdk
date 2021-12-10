import { NxtpSdkEvents } from '@connext/nxtp-sdk'
import { TransactionResponse } from '@ethersproject/abstract-provider'
import { constants } from 'ethers'

import Lifi from '../../Lifi'

import {
  ChainId,
  ExecuteCrossParams,
  getChainById,
  isLifiStep,
  isSwapStep,
} from '../../types'
import { personalizeStep } from '../../utils'
import { getRpcUrls } from '../../connectors'
import { checkAllowance } from '../allowance.execute'
import nxtp from './nxtp'

export class NXTPExecutionManager {
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
    const transactionId = step.id

    // STEP 0: Check Allowance ////////////////////////////////////////////////
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

    // STEP 1: Get Public Key ////////////////////////////////////////////////
    if (
      isLifiStep(step) &&
      isSwapStep(step.includedSteps[step.includedSteps.length - 1])
    ) {
      // -> set currentExecution
      const keyProcess = statusManager.createAndPushProcess(
        'publicKey',
        updateExecution,
        currentExecution,
        'Provide Public Key',
        {
          currentExecution: 'ACTION_REQUIRED',
        }
      )
      if (!this.shouldContinue) return currentExecution
      // -> request key
      try {
        const encryptionPublicKey = await (window as any).ethereum.request({
          method: 'eth_getEncryptionPublicKey',
          params: [await signer.getAddress()], // you must have access to the specified account
        })
        // store key
        if (!step.estimate.data) step.estimate.data = {}
        step.estimate.data.encryptionPublicKey = encryptionPublicKey
      } catch (e) {
        statusManager.setStatusFailed(
          updateExecution,
          currentExecution,
          keyProcess
        )
        throw e
      }
      // -> set currentExecution
      statusManager.setStatusDone(updateExecution, currentExecution, keyProcess)
    }

    // STEP 2: Get Transaction ////////////////////////////////////////////////
    const crossProcess = statusManager.createAndPushProcess(
      'crossProcess',
      updateExecution,
      currentExecution,
      'Prepare Transaction'
    )
    if (crossProcess.currentExecution !== 'DONE') {
      let tx: TransactionResponse
      try {
        if (crossProcess.txHash) {
          // -> restore existing tx
          crossProcess.currentExecution = 'PENDING'
          crossProcess.message = 'Wait for '
          updateExecution(currentExecution)
          tx = await signer.provider!.getTransaction(crossProcess.txHash)
        } else {
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
            fromChain.metamask.blockExplorerUrls[0] +
            'tx/' +
            crossProcess.txHash
          crossProcess.message = 'Wait for'
          updateExecution(currentExecution)
        }
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

      await tx.wait()

      crossProcess.message = 'Transfer started: '
      statusManager.setStatusDone(
        updateExecution,
        currentExecution,
        crossProcess
      )
    }

    // STEP 5: Wait for ReceiverTransactionPrepared //////////////////////////////////////
    const claimProcess = statusManager.createAndPushProcess(
      'claimProcess',
      updateExecution,
      currentExecution,
      'Wait for bridge'
    )
    // reset previous process
    claimProcess.message = 'Wait for bridge'
    claimProcess.currentExecution = 'PENDING'
    updateExecution(currentExecution)

    // init sdk
    const crossableChains = [ChainId.ETH, action.fromChainId, action.toChainId]
    const chainProviders = getRpcUrls(crossableChains)
    const nxtpSDK = await nxtp.setup(signer, chainProviders)

    const preparedTransactionPromise = nxtpSDK.waitFor(
      NxtpSdkEvents.ReceiverTransactionPrepared,
      10 * 60 * 1000, // = 10 minutes
      (data) => data.txData.transactionId === transactionId
    )

    // find current currentExecution
    const transactions = await nxtpSDK.getActiveTransactions()
    const foundTransaction = transactions.find(
      (transfer) =>
        transfer.crosschainTx.invariant.transactionId === transactionId
    )

    // check if already done?
    if (!foundTransaction) {
      const historicalTransactions = await nxtpSDK.getHistoricalTransactions()
      const foundTransaction = historicalTransactions.find(
        (transfer) =>
          transfer.crosschainTx.invariant.transactionId === transactionId
      )
      if (foundTransaction) {
        claimProcess.txHash = foundTransaction.fulfilledTxHash
        claimProcess.txLink =
          toChain.metamask.blockExplorerUrls[0] + 'tx/' + claimProcess.txHash
        claimProcess.message = 'Swapped:'
        currentExecution.fromAmount = estimate.fromAmount
        currentExecution.toAmount = estimate.toAmount
        currentExecution.status = 'DONE'
        statusManager.setStatusDone(
          updateExecution,
          currentExecution,
          claimProcess
        )

        // DONE
        nxtpSDK.removeAllListeners()
        return currentExecution
      }
    }

    const preparedTransaction = await preparedTransactionPromise

    // STEP 6: Claim //////////////////////////////////////////////////////////
    claimProcess.currentExecution = 'ACTION_REQUIRED'
    claimProcess.message = 'Claim transfer'
    updateExecution(currentExecution)
    if (!this.shouldContinue) {
      nxtpSDK.removeAllListeners()
      return currentExecution
    }

    const fulfillPromise = nxtpSDK.fulfillTransfer(preparedTransaction)

    // STEP 7: Wait for signature //////////////////////////////////////////////////////////
    await nxtpSDK.waitFor(
      NxtpSdkEvents.ReceiverPrepareSigned,
      20 * 60 * 1000, // = 20 minutes
      (data) => data.transactionId === transactionId
    )

    claimProcess.currentExecution = 'PENDING'
    claimProcess.message = 'Waiting for claim'
    updateExecution(currentExecution)

    try {
      const data = await fulfillPromise
      claimProcess.txHash = data.transactionHash
      claimProcess.txLink =
        toChain.metamask.blockExplorerUrls[0] + 'tx/' + claimProcess.txHash
      claimProcess.message = 'Swapped:'
    } catch (e) {
      // handle errors
      nxtpSDK.removeAllListeners()
      statusManager.setStatusFailed(
        updateExecution,
        currentExecution,
        claimProcess
      )
      throw e
    }

    // TODO: parse receipt to check result
    // const provider = getRpcProvider(step.action.toChainId)
    // const receipt = await provider.waitForTransaction(claimProcess.txHash)

    currentExecution.fromAmount = estimate.fromAmount
    currentExecution.toAmount = estimate.toAmount
    currentExecution.status = 'DONE'
    statusManager.setStatusDone(updateExecution, currentExecution, claimProcess)

    // DONE
    nxtpSDK.removeAllListeners()
    return currentExecution
  }
}
