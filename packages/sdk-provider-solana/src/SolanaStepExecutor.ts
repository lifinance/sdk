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
  type Transaction,
} from '@solana/kit'
import { SolanaSignTransaction } from '@solana/wallet-standard-features'
import type { Wallet } from '@wallet-standard/base'
import { sendAndConfirmBundle } from './actions/sendAndConfirmBundle.js'
import { sendAndConfirmTransaction } from './actions/sendAndConfirmTransaction.js'
import { parseSolanaErrors } from './errors/parseSolanaErrors.js'
import { callSolanaRpcsWithRetry } from './rpc/utils.js'
import type { SolanaStepExecutorOptions } from './types.js'
import { base64ToUint8Array } from './utils/base64ToUint8Array.js'
import { getWalletFeature } from './utils/getWalletFeature.js'
import { withTimeout } from './utils/withTimeout.js'

type ConfirmedTransactionResult = {
  txSignature: string
  bundleId?: string
}

export class SolanaStepExecutor extends BaseStepExecutor {
  private wallet: Wallet
  constructor(options: SolanaStepExecutorOptions) {
    super(options)
    this.wallet = options.wallet
  }

  private shouldUseJitoBundle(
    client: SDKClient,
    transactions: Transaction[]
  ): boolean {
    const routeOptions = client.config.routeOptions as
      | Record<string, unknown>
      | undefined
    const isJitoBundleEnabled = Boolean(routeOptions?.jitoBundle)

    if (transactions.length > 1 && !isJitoBundleEnabled) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        `Received ${transactions.length} transactions but Jito bundle is not enabled. Enable Jito bundle in routeOptions to submit multiple transactions.`
      )
    }

    return transactions.length > 1 && isJitoBundleEnabled
  }

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
        action = this.statusManager.updateAction(step, action.type, 'STARTED')

        // Check balance
        await checkBalance(client, walletAccount.address, step)

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

        action = this.statusManager.updateAction(
          step,
          action.type,
          'ACTION_REQUIRED'
        )

        if (!this.allowUserInteraction) {
          return step
        }

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

        // Handle both single transaction (string) and multiple transactions (array)
        const transactionDataArray = Array.isArray(transactionRequest.data)
          ? transactionRequest.data
          : [transactionRequest.data]

        const transactionBytesArray = transactionDataArray.map((data) =>
          base64ToUint8Array(data)
        )

        const signedTransactionOutputs = await withTimeout(
          async () => {
            const { signTransaction } = getWalletFeature(
              this.wallet,
              SolanaSignTransaction
            )
            // Spread the inputs to sign all transactions at once
            return signTransaction(
              ...transactionBytesArray.map((transaction) => ({
                account: walletAccount,
                transaction,
              }))
            )
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

        // Decode all signed transactions
        const signedTransactions: Transaction[] = signedTransactionOutputs.map(
          (output) => transactionCodec.decode(output.signedTransaction)
        )

        const useJitoBundle = this.shouldUseJitoBundle(
          client,
          signedTransactions
        )

        let confirmedTransaction: ConfirmedTransactionResult

        if (useJitoBundle) {
          // Use Jito bundle for transaction submission
          const bundleResult = await sendAndConfirmBundle(
            client,
            signedTransactions
          )

          const allConfirmed = bundleResult.signatureResults.every(
            (result) => result !== null
          )

          if (!allConfirmed) {
            throw new TransactionError(
              LiFiErrorCode.TransactionFailed,
              'Bundle confirmation failed: Not all transactions were confirmed.'
            )
          }

          // Check for errors in any of the transactions
          const failedResult = bundleResult.signatureResults.find(
            (result) => result?.err
          )
          if (failedResult?.err) {
            const reason =
              typeof failedResult.err === 'object'
                ? JSON.stringify(failedResult.err)
                : String(failedResult.err)
            throw new TransactionError(
              LiFiErrorCode.TransactionFailed,
              `Transaction failed: ${reason}`
            )
          }

          confirmedTransaction = {
            txSignature: bundleResult.txSignatures[0],
            bundleId: bundleResult.bundleId,
          }
        } else {
          // Use regular transaction submission
          const signedTransaction = signedTransactions[0]

          const encodedTransaction =
            getBase64EncodedWireTransaction(signedTransaction)

          const simulationResult = await callSolanaRpcsWithRetry(
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

          const result = await sendAndConfirmTransaction(
            client,
            signedTransaction
          )

          if (!result.signatureResult) {
            throw new TransactionError(
              LiFiErrorCode.TransactionExpired,
              'Transaction has expired: The block height has exceeded the maximum allowed limit.'
            )
          }

          if (result.signatureResult.err) {
            const reason =
              typeof result.signatureResult.err === 'object'
                ? JSON.stringify(result.signatureResult.err)
                : result.signatureResult.err
            throw new TransactionError(
              LiFiErrorCode.TransactionFailed,
              `Transaction failed: ${reason}`
            )
          }

          confirmedTransaction = {
            txSignature: result.txSignature,
          }
        }

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
