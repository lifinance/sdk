import {
  getBase64EncodedWireTransaction,
  getTransactionCodec,
  type Transaction,
} from '@solana/kit'
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
import { parseSolanaErrors } from './parseSolanaErrors.js'
import { sendAndConfirmTransaction } from './sendAndConfirmTransaction.js'
import type { SolanaStepExecutorOptions } from './types.js'

export class SolanaStepExecutor extends BaseStepExecutor {
  private transactionSigner: SolanaStepExecutorOptions['transactionSigner']

  constructor(options: SolanaStepExecutorOptions) {
    super(options)
    this.transactionSigner = options.transactionSigner
  }

  checkWalletAdapter = (step: LiFiStepExtended) => {
    // Prevent execution of the quote by wallet different from the one which requested the quote
    const signerAddress = String(this.transactionSigner.address)
    if (signerAddress !== step.action.fromAddress) {
      throw new TransactionError(
        LiFiErrorCode.WalletChangedDuringExecution,
        'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
      )
    }
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
        await checkBalance(step.action.fromAddress!, step)

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

        if (!transactionRequest.data) {
          throw new TransactionError(
            LiFiErrorCode.TransactionUnprepared,
            'Unable to prepare transaction.'
          )
        }

        const transactionBytes = base64ToUint8Array(transactionRequest.data)

        this.checkWalletAdapter(step)

        // Decode transaction bytes to Transaction object
        const transactionCodec = getTransactionCodec()
        const transaction = transactionCodec.decode(
          transactionBytes
        ) as Transaction

        // We give users 2 minutes to sign the transaction or it should be considered expired
        const signedTransactions = await withTimeout<
          readonly (Transaction & { lifetimeConstraint?: unknown })[]
        >(
          () => this.transactionSigner.modifyAndSignTransactions([transaction]),
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

        const signedTx = signedTransactions[0] as Transaction

        process = this.statusManager.updateProcess(
          step,
          process.type,
          'PENDING'
        )
        const encondedTxn = getBase64EncodedWireTransaction(signedTx)

        const simulationResult = await callSolanaWithRetry((connection) =>
          connection
            .simulateTransaction(encondedTxn, {
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

        const confirmedTx = await sendAndConfirmTransaction(signedTx)

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
