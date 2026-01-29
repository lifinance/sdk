import {
  BaseStepExecutor,
  checkBalance,
  getStepTransaction,
  LiFiErrorCode,
  type LiFiStepExtended,
  type SDKClient,
  stepComparison,
  TransactionError,
  type TransactionParameters,
  waitForDestinationChainTransaction,
} from '@lifi/sdk'
import {
  getBase64EncodedWireTransaction,
  getTransactionCodec,
} from '@solana/kit'
import { SolanaSignTransaction } from '@solana/wallet-standard-features'
import type { Wallet } from '@wallet-standard/base'
import { sendAndConfirmTransaction } from './actions/sendAndConfirmTransaction.js'
import { callSolanaWithRetry } from './client/connection.js'
import { parseSolanaErrors } from './errors/parseSolanaErrors.js'
import type { SolanaStepExecutorOptions } from './types.js'
import { base64ToUint8Array } from './utils/base64ToUint8Array.js'
import { getWalletFeature } from './utils/getWalletFeature.js'
import { withTimeout } from './utils/withTimeout.js'

export class SolanaStepExecutor extends BaseStepExecutor {
  private wallet: Wallet
  constructor(options: SolanaStepExecutorOptions) {
    super(options)
    this.wallet = options.wallet
  }

  // --- TASK: SolanaCheckWalletTask (helper) ---
  // Resolve wallet account for step.fromAddress; fail if wallet/address mismatch (like Bitcoin checkClient).
  getWalletAccount = async (step: LiFiStepExtended) => {
    const account = this.wallet.accounts.find(
      (account) => account.address === step.action.fromAddress
    )

    if (!account) {
      throw new TransactionError(
        LiFiErrorCode.WalletChangedDuringExecution,
        'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
      )
    }

    return account
  }

  executeStep = async (
    client: SDKClient,
    step: LiFiStepExtended
  ): Promise<LiFiStepExtended> => {
    // Task-split overview:
    // 1. SolanaStartActionTask      – init execution, get wallet account (SolanaCheckWalletTask), find/create action, STARTED
    // 2. SolanaCheckBalanceTask     – check balance before preparing tx
    // 3. SolanaPrepareTransactionTask – getStepTransaction, stepComparison, transactionRequest + hook
    // 4. SolanaAwaitUserSignatureTask – ACTION_REQUIRED; PAUSED if !allowUserInteraction
    // 5. SolanaSignAndExecuteTask   – sign tx (with timeout), decode, simulate, sendAndConfirm, update PENDING, DONE for bridge
    // 6. WaitForDestinationChainTask – waitForDestinationChainTransaction
    // --- TASK: SolanaStartActionTask ---
    step.execution = this.statusManager.initExecutionObject(step)

    const fromChain = await client.getChainById(step.action.fromChainId)
    const toChain = await client.getChainById(step.action.toChainId)

    const isBridgeExecution = fromChain.id !== toChain.id
    const currentActionType = isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'

    const walletAccount = await this.getWalletAccount(step)

    let action = this.statusManager.findOrCreateAction({
      step,
      type: currentActionType,
      chainId: fromChain.id,
    })

    if (action.status !== 'DONE') {
      try {
        // --- TASK: SolanaStartActionTask (status update) ---
        action = this.statusManager.updateAction(step, action.type, 'STARTED')

        // --- TASK: SolanaCheckBalanceTask ---
        // Check balance
        await checkBalance(client, walletAccount.address, step)

        // --- TASK: SolanaPrepareTransactionTask ---
        // Fetch step transaction via getStepTransaction, run stepComparison, ensure transactionRequest.data exists.
        // Create new transaction
        if (!step.transactionRequest) {
          const { execution, ...stepBase } = step
          const updatedStep = await getStepTransaction(client, stepBase)
          const comparedStep = await stepComparison(
            this.statusManager,
            step,
            updatedStep,
            this.allowUserInteraction,
            this.executionOptions
          )
          Object.assign(step, {
            ...comparedStep,
            execution: step.execution,
          })
        }

        if (!step.transactionRequest?.data) {
          throw new TransactionError(
            LiFiErrorCode.TransactionUnprepared,
            'Unable to prepare transaction.'
          )
        }

        // --- TASK: SolanaAwaitUserSignatureTask (pause boundary) ---
        // Set action to ACTION_REQUIRED. If !allowUserInteraction, return PAUSED (saveState for resume).
        action = this.statusManager.updateAction(
          step,
          action.type,
          'ACTION_REQUIRED'
        )

        if (!this.allowUserInteraction) {
          return step
        }

        // --- TASK: SolanaPrepareTransactionTask (request + hook) ---
        // Build transactionRequest from step, apply updateTransactionRequestHook if present.
        let transactionRequest: TransactionParameters = {
          data: step.transactionRequest.data,
        }

        if (this.executionOptions?.updateTransactionRequestHook) {
          const customizedTransactionRequest: TransactionParameters =
            await this.executionOptions.updateTransactionRequestHook({
              requestType: 'transaction',
              ...transactionRequest,
            })

          transactionRequest = {
            ...transactionRequest,
            ...customizedTransactionRequest,
          }
        }

        if (!transactionRequest.data) {
          throw new TransactionError(
            LiFiErrorCode.TransactionUnprepared,
            'Unable to prepare transaction.'
          )
        }

        // --- TASK: SolanaSignAndExecuteTask ---
        // Decode tx bytes, sign via wallet (with timeout), decode signed tx, simulate (callSolanaWithRetry),
        // sendAndConfirmTransaction, validate signatureResult, update action PENDING with txHash/txLink, DONE for bridge.
        const transactionBytes = base64ToUint8Array(transactionRequest.data)

        const signedTransactionOutputs = await withTimeout(
          async () => {
            const { signTransaction } = getWalletFeature(
              this.wallet,
              SolanaSignTransaction
            )
            return signTransaction({
              account: walletAccount,
              transaction: transactionBytes,
            })
          },
          {
            // https://solana.com/docs/advanced/confirmation#transaction-expiration
            // Use 2 minutes to account for fluctuations
            timeout: 120_000,
            errorInstance: new TransactionError(
              LiFiErrorCode.TransactionExpired,
              'Transaction has expired: blockhash is no longer recent enough.'
            ),
          }
        )

        if (signedTransactionOutputs.length === 0) {
          throw new TransactionError(
            LiFiErrorCode.TransactionUnprepared,
            'No signed transaction returned from signer.'
          )
        }

        action = this.statusManager.updateAction(step, action.type, 'PENDING')

        const transactionCodec = getTransactionCodec()

        const signedTransaction = transactionCodec.decode(
          signedTransactionOutputs[0].signedTransaction
        )

        const encodedTransaction =
          getBase64EncodedWireTransaction(signedTransaction)

        const simulationResult = await callSolanaWithRetry(
          client,
          (connection) =>
            connection
              .simulateTransaction(encodedTransaction, {
                commitment: 'confirmed',
                replaceRecentBlockhash: true,
                encoding: 'base64',
              })
              .send()
        )

        if (simulationResult.value.err) {
          const errorMessage =
            typeof simulationResult.value.err === 'object'
              ? JSON.stringify(simulationResult.value.err)
              : simulationResult.value.err
          throw new TransactionError(
            LiFiErrorCode.TransactionSimulationFailed,
            `Transaction simulation failed: ${errorMessage}`,
            new Error(errorMessage)
          )
        }

        const confirmedTransaction = await sendAndConfirmTransaction(
          client,
          signedTransaction
        )

        if (!confirmedTransaction.signatureResult) {
          throw new TransactionError(
            LiFiErrorCode.TransactionExpired,
            'Transaction has expired: The block height has exceeded the maximum allowed limit.'
          )
        }

        if (confirmedTransaction.signatureResult.err) {
          const reason =
            typeof confirmedTransaction.signatureResult.err === 'object'
              ? JSON.stringify(confirmedTransaction.signatureResult.err)
              : confirmedTransaction.signatureResult.err
          throw new TransactionError(
            LiFiErrorCode.TransactionFailed,
            `Transaction failed: ${reason}`
          )
        }

        // --- End SolanaSignAndExecuteTask: persist txHash/txLink ---
        // Transaction has been confirmed and we can update the action
        action = this.statusManager.updateAction(step, action.type, 'PENDING', {
          txHash: confirmedTransaction.txSignature,
          txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${confirmedTransaction.txSignature}`,
        })

        if (isBridgeExecution) {
          action = this.statusManager.updateAction(step, action.type, 'DONE')
        }
      } catch (e: any) {
        const error = await parseSolanaErrors(e, step, action)
        action = this.statusManager.updateAction(step, action.type, 'FAILED', {
          error: {
            message: error.cause.message,
            code: error.code,
          },
        })
        throw error
      }
    }

    // --- TASK: WaitForDestinationChainTask (or common helper) ---
    // Wait for destination-chain transaction confirmation; update statusManager as needed.
    await waitForDestinationChainTransaction(
      client,
      step,
      action,
      fromChain,
      toChain,
      this.statusManager
    )

    // DONE
    return step
  }
}
