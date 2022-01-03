import { NxtpSdkEvents } from '@connext/nxtp-sdk'
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
  ExecuteCrossParams,
  Execution,
  getChainById,
  isLifiStep,
  isSwapStep,
} from '../../types'
import { personalizeStep } from '../../utils'
import { getRpcProvider, getRpcUrls } from '../../connectors'
import { checkAllowance } from '../allowance.execute'
import nxtp from './nxtp'
import { getDeployedTransactionManagerContract } from '@connext/nxtp-sdk/dist/transactionManager/transactionManager'
import { signFulfillTransactionPayload } from '@connext/nxtp-sdk/dist/utils'
import { balanceCheck } from '../balanceCheck.execute'

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
    const oldCrossProcess = status.process.find((p) => p.id === 'crossProcess')
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
    // check that a public key hook is given and that step allows encryption
    if (
      hooks.getPublicKeyHook &&
      isLifiStep(step) &&
      isSwapStep(step.includedSteps[step.includedSteps.length - 1]) &&
      (!oldCrossProcess || !oldCrossProcess.txHash)
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
      } catch (e: any) {
        if (e.message) keyProcess.errorMessage = e.message
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
          const fromProvider = getRpcProvider(step.action.fromChainId)
          tx = await fromProvider.getTransaction(crossProcess.txHash)
        } else {
          // Check balance
          await balanceCheck(signer, step)

          // Prepare transaction
          const personalizedStep = await personalizeStep(signer, step)
          const { transactionRequest } = await Lifi.getStepTransaction(
            personalizedStep
          )
          if (!transactionRequest) {
            crossProcess.errorMessage = 'Unable to prepare Transaction'
            setStatusFailed(update, status, crossProcess)
            throw crossProcess.errorMessage
          }

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

      try {
        await tx.wait()
      } catch (e: any) {
        if (e.code === 'TRANSACTION_REPLACED' && e.replacement) {
          crossProcess.txHash = e.replacement.hash
          crossProcess.txLink =
            fromChain.metamask.blockExplorerUrls[0] +
            'tx/' +
            crossProcess.txHash
        } else {
          if (e.message) crossProcess.errorMessage = e.message
          if (e.code) crossProcess.errorCode = e.code
          setStatusFailed(update, status, crossProcess)
          throw e
        }
      }

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
    const transactions = await nxtpBaseSDK
      .getActiveTransactions()
      .catch(() => [])
    const foundTransaction = transactions.find(
      (transfer) =>
        transfer.crosschainTx.invariant.transactionId === transactionId
    )

    // check if already done?
    if (!foundTransaction) {
      const historicalTransactions = await nxtpBaseSDK
        .getHistoricalTransactions()
        .catch(() => [])
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

    // STEP 6: Wait for signature //////////////////////////////////////////////////////////
    let calculatedRelayerFee
    let signature
    try {
      calculatedRelayerFee = await nxtp.calculateRelayerFee(nxtpBaseSDK, {
        txData: {
          sendingChainId: action.fromChainId,
          sendingAssetId: action.fromToken.address,
          receivingChainId: action.toChainId,
          receivingAssetId: action.toToken.address,
        },
      })

      const receivingChainTxManager = getDeployedTransactionManagerContract(
        action.toChainId
      )
      if (!receivingChainTxManager) {
        setStatusFailed(update, status, claimProcess)
        nxtpSDK.removeAllListeners()
        throw new Error(
          'No TransactionManager definded for chain: ${action.toChainId}'
        )
      }

      claimProcess.status = 'ACTION_REQUIRED'
      claimProcess.message = 'Provide Signature'
      update(status)
      if (!this.shouldContinue) {
        nxtpSDK.removeAllListeners()
        return status
      }

      signature = await signFulfillTransactionPayload(
        transactionId,
        calculatedRelayerFee,
        action.toChainId,
        receivingChainTxManager.address,
        signer
      )
    } catch (e: any) {
      if (e.message) claimProcess.errorMessage = e.message
      setStatusFailed(update, status, claimProcess)
      nxtpSDK.removeAllListeners()
      throw e
    }

    // STEP 7: Wait for Bridge //////////////////////////////////////////////////////////
    claimProcess.message = 'Wait for bridge (1-5 min)'
    claimProcess.status = 'PENDING'
    update(status)

    let preparedTransaction
    try {
      preparedTransaction = await preparedTransactionPromise
    } catch (e: any) {
      if (e.message) claimProcess.errorMessage = e.message
      setStatusFailed(update, status, claimProcess)
      nxtpSDK.removeAllListeners()
      throw e
    }

    // STEP 8: Decrypt CallData //////////////////////////////////////////////////////////
    let callData = '0x'
    // Does it cointain callData?
    if (preparedTransaction.txData.callDataHash !== utils.keccak256(callData)) {
      if (
        preparedTransaction.txData.callDataHash ===
        utils.keccak256(preparedTransaction.encryptedCallData)
      ) {
        // Call data was passed unencrypted
        callData = preparedTransaction.encryptedCallData
      } else if (hooks.decryptHook) {
        // Tigger hock to decrypt data
        claimProcess.status = 'ACTION_REQUIRED'
        claimProcess.message = 'Decrypt transaction data'
        update(status)
        if (!this.shouldContinue) {
          nxtpSDK.removeAllListeners()
          return status
        }

        try {
          callData = await hooks.decryptHook(
            preparedTransaction.encryptedCallData
          )
        } catch (e: any) {
          if (e.message) claimProcess.errorMessage = e.message
          setStatusFailed(update, status, claimProcess)
          nxtpSDK.removeAllListeners()
          throw e
        }
      } else {
        // Continue without call data
        console.warn(
          'CallData not forwared because no decryptHook is set to decypt it.'
        )
      }
    }

    // STEP 9: Wait for Claim //////////////////////////////////////////////////////////
    claimProcess.status = 'PENDING'
    claimProcess.message = 'Waiting for claim (1-5 min)'
    update(status)

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
    } catch (e: any) {
      if (e.message) claimProcess.errorMessage = e.message
      nxtpSDK.removeAllListeners()
      setStatusFailed(update, status, claimProcess)
      throw e
    }

    const provider = getRpcProvider(step.action.toChainId)
    const claimTx = await provider.getTransaction(claimProcess.txHash)
    const receipt = await provider.waitForTransaction(claimProcess.txHash)

    // wait until balance rpc contains block number >= the claim block number to make sure the funds are available on the users wallet
    let balanceBlockNumber = 0
    const walletAddress = await signer.getAddress()
    do {
      // get balance
      const tokenAmount = await Lifi.getTokenBalance(
        walletAddress,
        step.action.toToken
      )
      if (tokenAmount && tokenAmount.blockNumber) {
        balanceBlockNumber = tokenAmount.blockNumber
      }
    } while (balanceBlockNumber < receipt.blockNumber)

    const parsedReceipt = nxtp.parseReceipt(
      await signer.getAddress(),
      action.toToken.address,
      claimTx,
      receipt
    )

    status.fromAmount = estimate.fromAmount
    status.toAmount = parsedReceipt.toAmount
    // status.gasUsed = parsedReceipt.gasUsed
    status.status = 'DONE'
    setStatusDone(update, status, claimProcess)

    // DONE
    nxtpSDK.removeAllListeners()
    return status
  }
}
