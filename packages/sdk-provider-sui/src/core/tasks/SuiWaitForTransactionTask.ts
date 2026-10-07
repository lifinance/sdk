import {
  BaseStepExecutionTask,
  type ExecutionAction,
  isResendAllowed,
  LiFiErrorCode,
  MAX_RESEND_AGE_MS,
  type SDKClient,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import {
  TransactionError as SuiClientTransactionError,
  type SuiClientTypes,
} from '@mysten/sui/client'
import { GrpcStatusCode, RpcError } from '@mysten/sui/grpc'
import { callSuiWithRetry } from '../../client/suiClient.js'
import type { SuiStepExecutorContext } from '../../types.js'
import { getSuiTxLink } from '../../utils/getSuiTxLink.js'
import {
  parseSuiSignedTransaction,
  type SuiSignedTransaction,
  verifySuiSignedTransaction,
} from '../../utils/suiSignedTransaction.js'
import { SUI_LOOKUP_TIMEOUT_MS } from '../constants.js'
import { callWithinDeadline } from './helpers/callWithinDeadline.js'
import { isSuiTransactionDropped } from './helpers/isSuiTransactionDropped.js'

export class SuiWaitForTransactionTask extends BaseStepExecutionTask {
  async run(context: SuiStepExecutorContext): Promise<TaskResult> {
    const {
      client,
      step,
      statusManager,
      isBridgeExecution,
      signedTransaction,
    } = context

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

    if (signedTransaction) {
      const result = await callSuiWithRetry(client, (client) =>
        client.core.waitForTransaction({
          digest: signedTransaction.digest,
        })
      )
      return complete(context, action, result)
    }

    // Resuming: the signing task did not run in this session. Continue with
    // the bytes and the digest persisted on the action; never sign again.
    const storedTransaction = action.txHex
      ? parseSuiSignedTransaction(action.txHex)
      : undefined

    if (action.txHex && !storedTransaction) {
      // Bytes that do not decode, or that are not canonical, can never be
      // executed or looked up.
      statusManager.updateAction(step, action.type, 'PENDING', {
        txHex: undefined,
      })
      if (!action.txHash) {
        // No execution ever returned for these bytes, so "Try again" signs again.
        throw new TransactionError(
          LiFiErrorCode.TransactionUnprepared,
          'Unable to resume transaction. The stored signed transaction is invalid.'
        )
      }
    }

    const digest = action.txHash ?? storedTransaction?.digest
    if (!digest) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Signed transaction is not found.'
      )
    }

    const found = await findSuiTransaction(client, digest)
    if (found) {
      return complete(context, action, found)
    }

    // Stored bytes prove nothing when their digest is not the stored txHash
    // (damaged storage) or their signature does not verify: the check also
    // fails for a scheme it cannot parse or cannot run, and the bytes may
    // have been sent. Then the SDK neither sends nor drops; it only waits,
    // and the outcome stays unknown.
    const doubtful =
      !!storedTransaction &&
      (storedTransaction.digest !== digest ||
        !(await isVerifiedSuiTransaction(storedTransaction)))

    const signedAt = step.execution?.signedAt
    if (
      !doubtful &&
      storedTransaction &&
      signedAt !== undefined &&
      isResendAllowed(signedAt)
    ) {
      // A digest executes at most once, so re-executing the stored bytes can
      // never run the swap twice.
      try {
        await reexecuteWithinAgeCap(client, storedTransaction, signedAt)
      } catch (error) {
        if (!isDefiniteSuiRejection(error)) {
          throw error
        }
        // The first execution may have landed meanwhile; then the refusal
        // only says that its inputs are spent.
        const landed = await findSuiTransaction(client, digest)
        if (landed) {
          return complete(context, action, landed)
        }
        // A node refusal does not prove the transaction absent, so the
        // outcome stays unknown.
        throw error
      }
    } else if (
      !doubtful &&
      (await isSuiTransactionDropped(client, step, digest))
    ) {
      // No resend: past the age cap, with no stored bytes, or with an unknown
      // signing time. Past the cap the bytes are never sent again, so a swap
      // on an old quote cannot execute hours later; the batch lookup proves
      // absence. Within the cap with only a txHash, and with an unknown
      // signing time, `isSuiTransactionDropped` returns false, so the task
      // waits.
      throw dropped(context, action)
    }

    const result = await callSuiWithRetry(client, (client) =>
      client.core.waitForTransaction({ digest })
    )
    return complete(context, action, result)
  }
}

/**
 * Looks the digest up once. Resolves `undefined` only when the RPCs answer
 * that it is unknown; any other error propagates as an unknown outcome.
 * Each node has `SUI_LOOKUP_TIMEOUT_MS` to answer; a node that does not
 * counts as failed, so the next node is asked.
 */
async function findSuiTransaction(
  client: SDKClient,
  digest: string
): Promise<SuiClientTypes.TransactionResult | undefined> {
  try {
    return await callSuiWithRetry(client, (client) =>
      callWithinDeadline(
        (signal) => client.core.getTransaction({ digest, signal }),
        SUI_LOOKUP_TIMEOUT_MS
      )
    )
  } catch (error) {
    if (
      error instanceof SuiClientTransactionError &&
      error.reason === 'notFound'
    ) {
      return undefined
    }
    throw error
  }
}

/**
 * Re-executes the stored bytes. `callSuiWithRetry` tries the nodes one by
 * one, so the age cap is checked before every try, and each try aborts when
 * the cap passes (spec 4.2.8). Past the cap it throws a plain error, which is
 * not a definite rejection, so the outcome stays unknown.
 *
 * Not `AbortSignal.timeout`: a published SDK should not raise its runtime
 * floor for it; one controller and one timer cover it.
 */
async function reexecuteWithinAgeCap(
  client: SDKClient,
  transaction: SuiSignedTransaction,
  signedAt: number
): Promise<void> {
  await callSuiWithRetry(client, async (client) => {
    if (!isResendAllowed(signedAt)) {
      throw createAgeCapError()
    }
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(createAgeCapError()),
      Math.max(0, signedAt + MAX_RESEND_AGE_MS - Date.now())
    )
    // A pending timer keeps Node's event loop alive. The `finally` clears it;
    // the unref only covers a path that skips it.
    const handle = timer as unknown as { unref?: () => void }
    handle.unref?.()
    try {
      return await client.core.executeTransaction({
        transaction: transaction.bytes,
        signatures: [transaction.signature],
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  })
}

/**
 * The resend age cap passed. The name makes the gRPC transport report an
 * abort with this reason as DEADLINE_EXCEEDED, as for any timeout.
 */
function createAgeCapError(): Error {
  const error = new Error('The resend age cap passed before the re-execution.')
  error.name = 'TimeoutError'
  return error
}

/** True only when the check runs and confirms the sender's signature. */
async function isVerifiedSuiTransaction(
  transaction: SuiSignedTransaction
): Promise<boolean> {
  try {
    return (await verifySuiSignedTransaction(transaction)) === true
  } catch {
    return false
  }
}

// The validators refused the transaction itself, e.g. because its input object
// versions are no longer available. Network errors and overloaded nodes do not
// count: the transaction may still land.
function isDefiniteSuiRejection(error: unknown): boolean {
  return (
    error instanceof RpcError &&
    error.code === GrpcStatusCode[GrpcStatusCode.INVALID_ARGUMENT]
  )
}

function complete(
  context: SuiStepExecutorContext,
  action: ExecutionAction,
  result: SuiClientTypes.TransactionResult
): TaskResult {
  const { step, statusManager, fromChain, isBridgeExecution } = context

  const transaction = result.Transaction ?? result.FailedTransaction
  if (transaction) {
    // Executed: the stored bytes are no longer needed.
    statusManager.updateAction(step, action.type, 'PENDING', {
      txHash: transaction.digest,
      txLink: getSuiTxLink(fromChain, transaction.digest),
      txHex: undefined,
    })
  }

  if (!transaction?.status.success) {
    throw new TransactionError(
      LiFiErrorCode.TransactionFailed,
      `Transaction failed: ${transaction?.status.error?.message ?? `Unexpected transaction result: ${result.$kind}`}`,
      undefined,
      // Executed and failed on chain: final. A malformed answer is not.
      transaction ? { final: true } : undefined
    )
  }

  if (isBridgeExecution) {
    statusManager.updateAction(step, action.type, 'DONE')
  }

  return { status: 'COMPLETED' }
}

function dropped(
  context: SuiStepExecutorContext,
  action: ExecutionAction
): TransactionError {
  context.statusManager.updateAction(context.step, action.type, 'PENDING', {
    txHex: undefined,
  })
  return new TransactionError(
    LiFiErrorCode.TransactionExpired,
    'Transaction expired before it was executed.',
    undefined,
    { final: true }
  )
}
