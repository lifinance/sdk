import type { SignerWalletAdapter } from '@solana/wallet-adapter-base'
import { VersionedTransaction } from '@solana/web3.js'
import { withTimeout } from 'viem'
import { config } from '../../config.js'
import { LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError } from '../../errors/errors.js'
import { getStepTransaction } from '../../services/api.js'
import { base64ToUint8Array } from '../../utils/base64ToUint8Array.js'
import { BaseStepExecutor } from '../BaseStepExecutor.js'
import { checkBalance } from '../checkBalance.js'
import { stepComparison } from '../stepComparison.js'
import type { LiFiStepExtended, TransactionParameters } from '../types.js'
import { waitForDestinationChainTransaction } from '../waitForDestinationChainTransaction.js'
import { callSolanaWithRetry } from './connection.js'
import { sendAndConfirmBundle } from './jito/sendAndConfirmBundle.js'
import { parseSolanaErrors } from './parseSolanaErrors.js'
import { sendAndConfirmTransaction } from './sendAndConfirmTransaction.js'
import type { SolanaStepExecutorOptions } from './types.js'

export class SolanaStepExecutor extends BaseStepExecutor {
  private walletAdapter: SignerWalletAdapter

  constructor(options: SolanaStepExecutorOptions) {
    super(options)
    this.walletAdapter = options.walletAdapter
  }

  checkWalletAdapter = (step: LiFiStepExtended) => {
    // Prevent execution of the quote by wallet different from the one which requested the quote
    if (this.walletAdapter.publicKey!.toString() !== step.action.fromAddress) {
      throw new TransactionError(
        LiFiErrorCode.WalletChangedDuringExecution,
        'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
      )
    }
  }

  /**
   * Deserializes base64-encoded transaction data into VersionedTransaction objects.
   * Handles both single transactions and arrays of transactions.
   *
   * @param transactionRequest - Transaction parameters containing base64-encoded transaction data
   * @returns {VersionedTransaction[]} Array of deserialized VersionedTransaction objects
   * @throws {TransactionError} If transaction data is missing or empty
   */
  private deserializeTransactions(transactionRequest: TransactionParameters) {
    if (!transactionRequest.data?.length) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction.'
      )
    }

    if (Array.isArray(transactionRequest.data)) {
      return transactionRequest.data.map((tx) =>
        VersionedTransaction.deserialize(base64ToUint8Array(tx))
      )
    } else {
      return [
        VersionedTransaction.deserialize(
          base64ToUint8Array(transactionRequest.data)
        ),
      ]
    }
  }

  /**
   * Determines whether to use Jito bundle submission for the given transactions.
   * Multiple transactions require Jito bundle support to be enabled in config.
   *
   * @param transactions - Array of transactions to evaluate
   * @returns {Boolean} True if Jito bundle should be used (multiple transactions + Jito enabled), false otherwise
   * @throws {TransactionError} If multiple transactions are provided but Jito bundle is not enabled
   */
  private shouldUseJitoBundle(transactions: VersionedTransaction[]): boolean {
    const isJitoBundleEnabled = Boolean(config.get().routeOptions?.jitoBundle)
    // If we received multiple transactions but Jito is not enabled,
    // this indicates an unexpected state (possibly an API error or misconfiguration)
    if (transactions.length > 1 && !isJitoBundleEnabled) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        `Received ${transactions.length} transactions but Jito bundle is not enabled. Multiple transactions require Jito bundle support. Please enable jitoBundle in routeOptions.`
      )
    }

    return transactions.length > 1 && isJitoBundleEnabled
  }

  executeStep = async (step: LiFiStepExtended): Promise<LiFiStepExtended> => {
    step.execution = this.statusManager.initExecutionObject(step)

    const fromChain = await config.getChainById(step.action.fromChainId)
    const toChain = await config.getChainById(step.action.toChainId)

    const isBridgeExecution = fromChain.id !== toChain.id
    const currentProcessType = isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'

    let process = this.statusManager.findOrCreateProcess({
      step,
      type: currentProcessType,
      chainId: fromChain.id,
    })

    if (process.status !== 'DONE') {
      try {
        process = this.statusManager.updateProcess(
          step,
          process.type,
          'STARTED'
        )

        // Check balance
        await checkBalance(this.walletAdapter.publicKey!.toString(), step)

        // Create new transaction
        if (!step.transactionRequest) {
          // biome-ignore lint/correctness/noUnusedVariables: destructuring
          const { execution, ...stepBase } = step
          const updatedStep = await getStepTransaction(stepBase)
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

        process = this.statusManager.updateProcess(
          step,
          process.type,
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

        const transactions = this.deserializeTransactions(transactionRequest)

        const shouldUseJitoBundle = this.shouldUseJitoBundle(transactions)

        this.checkWalletAdapter(step)

        // We give users 2 minutes to sign the transaction or it should be considered expired
        const signedTransactions = await withTimeout<VersionedTransaction[]>(
          () => this.walletAdapter.signAllTransactions(transactions),
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

        process = this.statusManager.updateProcess(
          step,
          process.type,
          'PENDING'
        )

        // Verify wallet adapter returned signed transactions
        if (!signedTransactions.length) {
          throw new TransactionError(
            LiFiErrorCode.TransactionUnprepared,
            'There was a problem signing the transactions. Wallet adapter did not return any signed transactions.'
          )
        }

        let confirmedTransaction: any

        if (shouldUseJitoBundle) {
          // Use Jito bundle for multiple transactions
          const bundleResult = await sendAndConfirmBundle(signedTransactions)

          // Check if all transactions in the bundle were confirmed
          // All transactions must succeed for the bundle to be considered successful
          const allConfirmed = bundleResult.signatureResults.every(
            (result) => result !== null
          )

          if (!allConfirmed) {
            throw new TransactionError(
              LiFiErrorCode.TransactionExpired,
              'One or more bundle transactions were not confirmed within the expected time frame.'
            )
          }

          // Check if any transaction in the bundle has an error
          const failedResult = bundleResult.signatureResults.find(
            (result) => result?.err !== null
          )

          if (failedResult) {
            const reason =
              typeof failedResult.err === 'object'
                ? JSON.stringify(failedResult.err)
                : failedResult.err
            throw new TransactionError(
              LiFiErrorCode.TransactionFailed,
              `Bundle transaction failed: ${reason}`
            )
          }

          // Use the first transaction's signature result for reporting
          // (all transactions succeeded if we reach here)
          confirmedTransaction = {
            signatureResult: bundleResult.signatureResults[0],
            txSignature: bundleResult.txSignatures[0],
            bundleId: bundleResult.bundleId,
          }
        } else {
          // Use regular transaction for single transaction
          const signedTransaction = signedTransactions[0]

          const simulationResult = await callSolanaWithRetry((connection) =>
            connection.simulateTransaction(signedTransaction, {
              commitment: 'confirmed',
              replaceRecentBlockhash: true,
            })
          )

          if (simulationResult.value.err) {
            throw new TransactionError(
              LiFiErrorCode.TransactionSimulationFailed,
              'Transaction simulation failed'
            )
          }

          confirmedTransaction =
            await sendAndConfirmTransaction(signedTransaction)
        }

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

        // Transaction has been confirmed and we can update the process
        process = this.statusManager.updateProcess(
          step,
          process.type,
          'PENDING',
          {
            txHash: confirmedTransaction.txSignature,
            txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${confirmedTransaction.txSignature}`,
          }
        )

        if (isBridgeExecution) {
          process = this.statusManager.updateProcess(step, process.type, 'DONE')
        }
      } catch (e: any) {
        const error = await parseSolanaErrors(e, step, process)
        process = this.statusManager.updateProcess(
          step,
          process.type,
          'FAILED',
          {
            error: {
              message: error.cause.message,
              code: error.code,
            },
          }
        )
        this.statusManager.updateExecution(step, 'FAILED')
        throw error
      }
    }

    await waitForDestinationChainTransaction(
      step,
      process,
      fromChain,
      toChain,
      this.statusManager
    )

    // DONE
    return step
  }
}
