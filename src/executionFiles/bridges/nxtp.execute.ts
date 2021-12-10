import {
  NxtpSdk,
  NxtpSdkEvents,
  ReceiverTransactionPreparedPayload,
} from '@connext/nxtp-sdk'
import { TransactionResponse } from '@ethersproject/abstract-provider'
import { constants, utils } from 'ethers'

import Lifi from '../../Lifi'
import {
  createAndPushProcess,
  initStatus,
  setStatusDone,
  setStatusFailed,
} from '../../status'
import {
  ChainId,
  DecryptHook,
  ExecuteCrossParams,
  Execution,
  getChainById,
  isLifiStep,
  isSwapStep,
} from '../../types'
import { personalizeStep } from '../../utils'
import { getRpcUrls } from '../../connectors'
import { checkAllowance } from '../allowance.execute'
import nxtp from './nxtp'
import { getDeployedChainIdsForGasFee } from '@connext/nxtp-sdk/dist/transactionManager/transactionManager'
import { signFulfillTransactionPayload } from '@connext/nxtp-sdk/dist/utils'

export class NXTPExecutionManager {
  shouldContinue = true

  setShouldContinue = (val: boolean): void => {
    this.shouldContinue = val
  }

  execute = async ({
    signer,
    step,
    updateStatus,
    hooks,
  }: ExecuteCrossParams): Promise<Execution> => {
    const { action, execution, estimate } = step
    const { status, update } = initStatus(updateStatus, execution)
    const fromChain = getChainById(action.fromChainId)
    const toChain = getChainById(action.toChainId)
    const transactionId = step.id

    // STEP 0: Check Allowance ////////////////////////////////////////////////
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

    // STEP 1: Get Public Key ////////////////////////////////////////////////
    if (
      isLifiStep(step) &&
      isSwapStep(step.includedSteps[step.includedSteps.length - 1])
    ) {
      // -> set status
      const keyProcess = createAndPushProcess(
        'publicKey',
        update,
        status,
        'Provide Public Key',
        {
          status: 'ACTION_REQUIRED',
        }
      )
      if (!this.shouldContinue) return status
      // -> request key
      try {
        const encryptionPublicKey = await hooks.getPublicKeyHook()
        // store key
        if (!step.estimate.data) step.estimate.data = {}
        step.estimate.data.encryptionPublicKey = encryptionPublicKey
      } catch (e) {
        setStatusFailed(update, status, keyProcess)
        throw e
      }
      // -> set status
      setStatusDone(update, status, keyProcess)
    }

    // STEP 2: Get Transaction ////////////////////////////////////////////////
    const crossProcess = createAndPushProcess(
      'crossProcess',
      update,
      status,
      'Prepare Transaction'
    )
    if (crossProcess.status !== 'DONE') {
      let tx: TransactionResponse
      try {
        if (crossProcess.txHash) {
          // -> restore existing tx
          crossProcess.status = 'PENDING'
          crossProcess.message = 'Wait for '
          update(status)
          tx = await signer.provider!.getTransaction(crossProcess.txHash)
        } else {
          const personalizedStep = await personalizeStep(signer, step)
          const { tx: transactionRequest } = await Lifi.getStepTransaction(
            personalizedStep
          )

          // STEP 3: Send Transaction ///////////////////////////////////////////////
          crossProcess.status = 'ACTION_REQUIRED'
          crossProcess.message = 'Sign Transaction'
          update(status)
          if (!this.shouldContinue) return status

          tx = await signer.sendTransaction(transactionRequest)

          // STEP 4: Wait for Transaction ///////////////////////////////////////////
          crossProcess.status = 'PENDING'
          crossProcess.txHash = tx.hash
          crossProcess.txLink =
            fromChain.metamask.blockExplorerUrls[0] +
            'tx/' +
            crossProcess.txHash
          crossProcess.message = 'Wait for'
          update(status)
        }
      } catch (e: any) {
        if (e.message) crossProcess.errorMessage = e.message
        if (e.code) crossProcess.errorCode = e.code
        setStatusFailed(update, status, crossProcess)
        throw e
      }

      await tx.wait()

      crossProcess.message = 'Transfer started: '
      setStatusDone(update, status, crossProcess)
    }

    // STEP 5: Wait for ReceiverTransactionPrepared //////////////////////////////////////
    const claimProcess = createAndPushProcess(
      'claimProcess',
      update,
      status,
      'Wait for bridge'
    )
    // reset previous process
    claimProcess.message = 'Wait for bridge'
    claimProcess.status = 'PENDING'
    update(status)

    // init sdk
    const crossableChains = [ChainId.ETH, action.fromChainId, action.toChainId]
    const chainProviders = getRpcUrls(crossableChains)
    const { sdk: nxtpSDK, sdkBase: nxtpBaseSDK } = await nxtp.setup(
      signer,
      chainProviders
    )

    const preparedTransactionPromise = nxtpSDK.waitFor(
      NxtpSdkEvents.ReceiverTransactionPrepared,
      10 * 60 * 1000, // = 10 minutes
      (data) => data.txData.transactionId === transactionId
    )

    // find current status
    const transactions = await nxtpBaseSDK.getActiveTransactions()
    const foundTransaction = transactions.find(
      (transfer) =>
        transfer.crosschainTx.invariant.transactionId === transactionId
    )

    // check if already done?
    if (!foundTransaction) {
      const historicalTransactions =
        await nxtpBaseSDK.getHistoricalTransactions()
      const foundTransaction = historicalTransactions.find(
        (transfer) =>
          transfer.crosschainTx.invariant.transactionId === transactionId
      )
      if (foundTransaction) {
        claimProcess.txHash = foundTransaction.fulfilledTxHash
        claimProcess.txLink =
          toChain.metamask.blockExplorerUrls[0] + 'tx/' + claimProcess.txHash
        claimProcess.message = 'Swapped:'
        status.fromAmount = estimate.fromAmount
        status.toAmount = estimate.toAmount
        status.status = 'DONE'
        setStatusDone(update, status, claimProcess)

        // DONE
        nxtpSDK.removeAllListeners()
        return status
      }
    }

    const preparedTransaction = await preparedTransactionPromise

    // STEP 6: Claim //////////////////////////////////////////////////////////
    claimProcess.status = 'ACTION_REQUIRED'
    claimProcess.message = 'Claim transfer'
    update(status)
    if (!this.shouldContinue) {
      nxtpSDK.removeAllListeners()
      return status
    }

    // STEP 7: Wait for signature //////////////////////////////////////////////////////////
    const calculatedRelayerFee = await this.calculateRelayerFee(
      nxtpSDK,
      preparedTransaction
    )

    const signature = await signFulfillTransactionPayload(
      preparedTransaction.txData.transactionId,
      calculatedRelayerFee,
      preparedTransaction.txData.receivingChainId,
      preparedTransaction.txData.receivingChainTxManagerAddress,
      signer
    )

    claimProcess.status = 'PENDING'
    claimProcess.message = 'Waiting for claim'
    update(status)

    const callData = await this.decryptData(
      hooks.decryptHook,
      preparedTransaction
    )

    try {
      const response = await nxtpBaseSDK.fulfillTransfer(
        preparedTransaction,
        signature,
        callData,
        calculatedRelayerFee,
        true
      )
      claimProcess.txHash = response.transactionResponse?.transactionHash
      claimProcess.txLink =
        toChain.metamask.blockExplorerUrls[0] + 'tx/' + claimProcess.txHash
      claimProcess.message = 'Swapped:'
    } catch (e) {
      // handle errors
      nxtpSDK.removeAllListeners()
      setStatusFailed(update, status, claimProcess)
      throw e
    }

    // TODO: parse receipt to check result
    // const provider = getRpcProvider(step.action.toChainId)
    // const receipt = await provider.waitForTransaction(claimProcess.txHash)

    status.fromAmount = estimate.fromAmount
    status.toAmount = estimate.toAmount
    status.status = 'DONE'
    setStatusDone(update, status, claimProcess)

    // DONE
    nxtpSDK.removeAllListeners()
    return status
  }

  private calculateRelayerFee = async (
    nxtpSDK: NxtpSdk,
    preparedTransaction: ReceiverTransactionPreparedPayload
  ): Promise<string> => {
    let calculateRelayerFee = '0'

    const chainIdsForPriceOracle = getDeployedChainIdsForGasFee()

    if (
      chainIdsForPriceOracle.includes(
        preparedTransaction.txData.receivingChainId
      )
    ) {
      const gasNeeded = await nxtpSDK.estimateMetaTxFeeInReceivingToken(
        preparedTransaction.txData.sendingChainId,
        preparedTransaction.txData.sendingAssetId,
        preparedTransaction.txData.receivingChainId,
        preparedTransaction.txData.receivingAssetId
      )

      calculateRelayerFee = gasNeeded.toString()
    }

    return calculateRelayerFee
  }

  private decryptData = async (
    decryptHook: DecryptHook,
    { txData, encryptedCallData }: ReceiverTransactionPreparedPayload
  ): Promise<string> => {
    let callData = '0x'
    if (txData.callDataHash !== utils.keccak256(callData)) {
      try {
        callData = await decryptHook(encryptedCallData)
      } catch (e) {
        // TODO: update process failed
      }
    }

    return callData
  }
}
