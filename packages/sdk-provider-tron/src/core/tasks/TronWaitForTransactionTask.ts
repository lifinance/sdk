import {
  BaseStepExecutionTask,
  type ExecutionAction,
  isFinalTransactionError,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import { broadcastTronTransaction } from '../../rpc/broadcastTronTransaction.js'
import { waitForTronTxConfirmation } from '../../rpc/waitForTronTxConfirmation.js'
import type { TronStepExecutorContext } from '../../types.js'
import { getTronTxLink } from '../../utils/getTronTxLink.js'
import { stripHexPrefix } from '../../utils/stripHexPrefix.js'
import { parseTronSignedTransaction } from '../../utils/tronSignedTransaction.js'
import { isTronTransactionDropped } from './helpers/isTronTransactionDropped.js'

export class TronWaitForTransactionTask extends BaseStepExecutionTask {
  async run(context: TronStepExecutorContext): Promise<TaskResult> {
    const {
      client,
      step,
      statusManager,
      fromChain,
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
      const broadcast = await broadcastTronTransaction(
        client,
        signedTransaction
      )
      if (broadcast.status !== 'accepted') {
        if (broadcast.status === 'rejected') {
          // Every node refused the transaction before its pending pool (or
          // no node was tried), so no node holds it. Drop the stored bytes:
          // "Try again" signs a new one.
          statusManager.updateAction(step, action.type, 'PENDING', {
            txHex: undefined,
          })
        }
        // A network error or a code after the push may leave the transaction
        // on a node, so an unknown outcome keeps the bytes for the resume.
        throw broadcast.error
      }

      statusManager.updateAction(step, action.type, 'PENDING', {
        txHash: broadcast.txHash,
        txLink: getTronTxLink(fromChain, broadcast.txHash),
      })

      return confirm(
        context,
        action,
        broadcast.txHash,
        signedTransaction.raw_data.expiration
      )
    }

    // Resuming: the signing task did not run in this session. Continue with
    // the bytes and the hash persisted on the action; never sign again.
    const storedTransaction = action.txHex
      ? parseTronSignedTransaction(action.txHex)
      : undefined

    if (action.txHex && !storedTransaction) {
      // Damaged stored bytes can never be sent or looked up.
      statusManager.updateAction(step, action.type, 'PENDING', {
        txHex: undefined,
      })
      if (!action.txHash) {
        // No node ever accepted these bytes, so "Try again" signs again.
        throw new TransactionError(
          LiFiErrorCode.TransactionUnprepared,
          'Unable to resume transaction. The stored signed transaction is invalid.'
        )
      }
    }

    const txHash =
      action.txHash ??
      (storedTransaction ? stripHexPrefix(storedTransaction.txID) : undefined)

    if (!txHash) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Signed transaction is not found.'
      )
    }

    const expiration = storedTransaction?.raw_data.expiration

    if (await isTronTransactionDropped(client, step, txHash, expiration)) {
      throw dropped(context, action)
    }

    if (storedTransaction) {
      // The transaction may already be included, so a refusal says nothing
      // about the outcome. The confirmation wait below decides it.
      const broadcast = await broadcastTronTransaction(
        client,
        storedTransaction
      )
      if (broadcast.status === 'accepted' && !action.txHash) {
        statusManager.updateAction(step, action.type, 'PENDING', {
          txHash,
          txLink: getTronTxLink(fromChain, txHash),
        })
      }
    }

    return confirm(context, action, txHash, expiration)
  }
}

async function confirm(
  context: TronStepExecutorContext,
  action: ExecutionAction,
  txHash: string,
  expiration: number | undefined
): Promise<TaskResult> {
  const { client, step, statusManager, fromChain, isBridgeExecution } = context
  // Included in a block: the stored bytes are no longer needed.
  const included = {
    txHash,
    txLink: getTronTxLink(fromChain, txHash),
    txHex: undefined,
  }

  try {
    await waitForTronTxConfirmation(client, txHash)
  } catch (error) {
    if (isFinalTransactionError(error)) {
      statusManager.updateAction(step, action.type, 'PENDING', included)
      throw error
    }
    // The wait ended without a result. Only an expired transaction that no
    // source knows is final; anything else stays unknown and keeps `txHex`.
    if (await isTronTransactionDropped(client, step, txHash, expiration)) {
      throw dropped(context, action)
    }
    throw error
  }

  statusManager.updateAction(step, action.type, 'PENDING', included)

  if (isBridgeExecution) {
    statusManager.updateAction(step, action.type, 'DONE')
  }

  return { status: 'COMPLETED' }
}

function dropped(
  context: TronStepExecutorContext,
  action: ExecutionAction
): TransactionError {
  context.statusManager.updateAction(context.step, action.type, 'PENDING', {
    txHex: undefined,
  })
  return new TransactionError(
    LiFiErrorCode.TransactionExpired,
    'Transaction expired before it was included in a block.',
    undefined,
    { final: true }
  )
}
