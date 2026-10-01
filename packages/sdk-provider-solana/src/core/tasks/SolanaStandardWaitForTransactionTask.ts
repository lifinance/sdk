import {
  BaseStepExecutionTask,
  type ExecutionAction,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import {
  getBase64EncodedWireTransaction,
  type Signature,
  type Transaction,
} from '@solana/kit'
import { sendAndConfirmTransaction } from '../../actions/sendAndConfirmTransaction.js'
import { callSolanaRpcsWithRetry } from '../../rpc/utils.js'
import type { SolanaStepExecutorContext } from '../../types.js'
import {
  getTransactionLifetime,
  type TransactionLifetime,
} from '../../utils/getTransactionLifetime.js'
import { SolanaTransactionDetailsError } from '../../utils/solanaErrorCause.js'
import { readSignature } from './readSignature.js'
import { resumeFromStore } from './resumeFromStore.js'
import {
  canResendStored,
  clearStoredTransactions,
  failureOf,
  getTxLink,
  sendAndSettle,
} from './transactionOutcome.js'
import type { ConfirmationMessages } from './unwrapConfirmation.js'

const MESSAGES: ConfirmationMessages = {
  rpcUnavailable:
    'Unable to confirm transaction: no Solana RPC returned a usable response.',
  notConfirmed: 'Transaction was not confirmed before the SDK stopped waiting.',
  allRpcsFailed: 'All Solana RPCs failed',
  someRpcsFailed:
    'Some Solana RPCs failed while the confirmation window was open',
}

export class SolanaStandardWaitForTransactionTask extends BaseStepExecutionTask {
  async run(context: SolanaStepExecutorContext): Promise<TaskResult> {
    const { step, statusManager, isBridgeExecution, signedTransactions } =
      context

    const action = statusManager.findAction(
      step,
      isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )
    if (!action) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Action not found.'
      )
    }

    // Resume mode: the sign task did not run in this session, so the signed
    // bytes come from `txHex`, or only the hash from `txHash`.
    if (!signedTransactions) {
      return resumeFromStore(context, action, {
        messages: MESSAGES,
        send: (stored, lifetimes) =>
          sendSigned(context, action, {
            transaction: stored.transactions[0],
            signature: stored.signature,
            lifetimes,
            resuming: true,
          }),
      })
    }

    if (!signedTransactions.length) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Signed transactions are not found.'
      )
    }

    // Use regular transaction submission
    const signedTransaction = signedTransactions[0]

    let txSignature: Signature
    let lifetime: TransactionLifetime
    try {
      if (!context.skipSimulation) {
        await simulate(context, signedTransaction)
      }
      txSignature = readSignature(signedTransaction)
      lifetime = await getTransactionLifetime(signedTransaction)
    } catch (error) {
      // Nothing left the SDK: the bytes go, so "Try again" signs again
      // instead of resending a transaction that failed before it was sent
      // (spec 4.2.9).
      clearStoredTransactions(context, action)
      throw error
    }

    return sendSigned(context, action, {
      transaction: signedTransaction,
      signature: txSignature,
      lifetimes: [lifetime],
      resuming: false,
    })
  }
}

/**
 * Sends one signed transaction, confirms it and applies the result rules
 * (spec 4.4.6), on the first run and on a resume alike.
 */
function sendSigned(
  context: SolanaStepExecutorContext,
  action: ExecutionAction,
  options: {
    transaction: Transaction
    signature: Signature
    lifetimes: TransactionLifetime[]
    /** An earlier run may already have sent these bytes. */
    resuming: boolean
  }
): Promise<TaskResult> {
  const { client, step, statusManager } = context
  const { transaction, signature, lifetimes, resuming } = options
  const txLink = getTxLink(context, signature)

  return sendAndSettle(context, action, {
    signature,
    send: () =>
      sendAndConfirmTransaction(client, transaction, {
        onBroadcast: () => {
          // The earliest honest point for both: an RPC has accepted the
          // transaction, so the signature now resolves on chain.
          statusManager.updateAction(step, action.type, 'PENDING', {
            txHash: signature,
            txLink,
          })
        },
        // Read at every send: bytes without their own expiry go out only
        // inside the resend age cap, however long the resend loop runs.
        mayResend: () => canResendStored(lifetimes, step.execution?.signedAt),
      }),
    confirmedFailure: failureOf,
    resuming,
    messages: MESSAGES,
  })
}

/** First run only: a resend never simulates. */
async function simulate(
  context: SolanaStepExecutorContext,
  signedTransaction: Transaction
): Promise<void> {
  const encodedTransaction = getBase64EncodedWireTransaction(signedTransaction)

  const simulationResult = await callSolanaRpcsWithRetry(
    context.client,
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
    const cause = new SolanaTransactionDetailsError(
      simulationResult.value.err,
      simulationResult.value.logs
    )
    throw new TransactionError(
      LiFiErrorCode.TransactionSimulationFailed,
      `Transaction simulation failed: ${cause.message}`,
      cause
    )
  }
}
