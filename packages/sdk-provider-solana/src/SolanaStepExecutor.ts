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
import type { SignerWalletAdapter } from '@solana/wallet-adapter-base'
import { VersionedTransaction } from '@solana/web3.js'
import { sendAndConfirmTransaction } from './actions/sendAndConfirmTransaction.js'
import { callSolanaWithRetry } from './client/connection.js'
import { parseSolanaErrors } from './errors/parseSolanaErrors.js'
import type { SolanaStepExecutorOptions } from './types.js'
import { base64ToUint8Array } from './utils/base64ToUint8Array.js'
import { withTimeout } from './utils/withTimeout.js'

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

  executeStep = async (
    client: SDKClient,
    step: LiFiStepExtended
  ): Promise<LiFiStepExtended> => {
    const fromChain = await client.getChainById(step.action.fromChainId)
    const toChain = await client.getChainById(step.action.toChainId)

    const isBridgeExecution = fromChain.id !== toChain.id
    const currentProcessType = isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'

    step = this.statusManager.transitionExecutionType(
      step,
      currentProcessType,
      {
        chainId: fromChain.id,
      }
    )

    if (step.execution?.status !== 'DONE') {
      try {
        step = this.statusManager.transitionExecutionStatus(step, 'STARTED')

        // Check balance
        await checkBalance(
          client,
          this.walletAdapter.publicKey!.toString(),
          step
        )

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

        step = this.statusManager.transitionExecutionStatus(
          step,
          'ACTION_REQUIRED'
        )

        if (!this.allowUserInteraction) {
          return step
        }

        let transactionRequest: TransactionParameters = {
          data: step.transactionRequest?.data,
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

        const versionedTransaction = VersionedTransaction.deserialize(
          base64ToUint8Array(transactionRequest.data)
        )

        this.checkWalletAdapter(step)

        // We give users 2 minutes to sign the transaction or it should be considered expired
        const signedTx = await withTimeout<VersionedTransaction>(
          () => this.walletAdapter.signTransaction(versionedTransaction),
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

        step = this.statusManager.transitionExecutionStatus(step, 'PENDING')

        const simulationResult = await callSolanaWithRetry(
          client,
          (connection) =>
            connection.simulateTransaction(signedTx, {
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

        const confirmedTx = await sendAndConfirmTransaction(client, signedTx)

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
        step = this.statusManager.transitionExecutionStatus(step, 'PENDING', {
          transaction: {
            type: step.execution!.type,
            txHash: confirmedTx.txSignature,
            txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${confirmedTx.txSignature}`,
            chainId: fromChain.id,
          },
        })

        if (isBridgeExecution) {
          step = this.statusManager.transitionExecutionStatus(step, 'DONE')
        }
      } catch (e: any) {
        const error = await parseSolanaErrors(e, step)
        step = this.statusManager.transitionExecutionStatus(step, 'FAILED', {
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
      fromChain,
      toChain,
      this.statusManager
    )

    // DONE
    return step
  }
}
