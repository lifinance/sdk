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
import { sendAndConfirmTransaction } from './actions/sendAndConfirmTransaction.js'
import { callSolanaWithRetry } from './client/connection.js'
import { parseSolanaErrors } from './errors/parseSolanaErrors.js'
import type { SolanaStepExecutorOptions, SolanaWallet } from './types.js'
import { base64ToUint8Array } from './utils/base64ToUint8Array.js'
import { withTimeout } from './utils/withTimeout.js'

export class SolanaStepExecutor extends BaseStepExecutor {
  private wallet: SolanaWallet
  constructor(options: SolanaStepExecutorOptions) {
    super(options)
    this.wallet = options.wallet
  }

  checkWalletAdapter = async (step: LiFiStepExtended) => {
    const signerAddress = this.wallet.account.address

    if (signerAddress !== step.action.fromAddress) {
      throw new TransactionError(
        LiFiErrorCode.WalletChangedDuringExecution,
        'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
      )
    }
  }

  executeStep = async (
    client: SDKClient,
    step: LiFiStepExtended
  ): Promise<LiFiStepExtended> => {
    step.execution = this.statusManager.initExecutionObject(step)

    const fromChain = await client.getChainById(step.action.fromChainId)
    const toChain = await client.getChainById(step.action.toChainId)

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
        await checkBalance(client, this.wallet.account.address, step)

        // Create new transaction
        if (!step.transactionRequest) {
          // biome-ignore lint/correctness/noUnusedVariables: destructuring
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

        if (!transactionRequest.data) {
          throw new TransactionError(
            LiFiErrorCode.TransactionUnprepared,
            'Unable to prepare transaction.'
          )
        }

        const transactionBytes = base64ToUint8Array(transactionRequest.data)

        await this.checkWalletAdapter(step)

        // Decode transaction bytes to Transaction object
        const transactionCodec = getTransactionCodec()
        const transaction = transactionCodec.decode(transactionBytes)

        // We give users 2 minutes to sign the transaction or it should be considered expired
        const signedTransactions = await withTimeout<readonly Transaction[]>(
          async () => {
            return [
              await this.wallet.signTransaction(transaction as Transaction),
            ]
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

        if (signedTransactions.length === 0) {
          throw new TransactionError(
            LiFiErrorCode.TransactionUnprepared,
            'No signed transaction returned from signer.'
          )
        }

        const signedTransaction = signedTransactions[0] as Transaction

        process = this.statusManager.updateProcess(
          step,
          process.type,
          'PENDING'
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
          throw new TransactionError(
            LiFiErrorCode.TransactionSimulationFailed,
            'Transaction simulation failed'
          )
        }

        const confirmedTx = await sendAndConfirmTransaction(
          client,
          signedTransaction
        )

        if (!confirmedTx.signatureResult) {
          throw new TransactionError(
            LiFiErrorCode.TransactionExpired,
            'Transaction has expired: The block height has exceeded the maximum allowed limit.'
          )
        }

        if (confirmedTx.signatureResult.err) {
          const reason =
            typeof confirmedTx.signatureResult.err === 'object'
              ? JSON.stringify(confirmedTx.signatureResult.err)
              : confirmedTx.signatureResult.err
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
            txHash: confirmedTx.txSignature,
            txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${confirmedTx.txSignature}`,
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
      client,
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
