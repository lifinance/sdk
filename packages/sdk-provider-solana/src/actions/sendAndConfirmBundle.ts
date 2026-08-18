import type { SDKClient } from '@lifi/sdk'
import { getBase64EncodedWireTransaction, type Transaction } from '@solana/kit'
import {
  type BundleConfirmation,
  confirmBundle,
} from '../confirmation/confirmBundle.js'
import { BRANCH_TIMEOUT_MS } from '../confirmation/createConfirmationDeadline.js'
import { type RaceResult, raceRpcs } from '../confirmation/raceRpcs.js'
import { getJitoRpcs } from '../rpc/registry.js'
import { getTransactionLifetime } from '../utils/getTransactionLifetime.js'

/**
 * Sends a Jito bundle to every Jito-capable RPC and returns as soon as one of
 * them confirms it.
 *
 * The deadline receives the lifetime of *every* signed transaction, not just
 * the first: a bundle is an array of independently built backend transactions
 * and they may not share a blockhash.
 */
export async function sendAndConfirmBundle(
  client: SDKClient,
  signedTransactions: Transaction[]
): Promise<RaceResult<BundleConfirmation>> {
  const jitoRpcs = await getJitoRpcs(client)

  const serializedTransactions = signedTransactions.map((transaction) =>
    getBase64EncodedWireTransaction(transaction)
  )

  const lifetimes = await Promise.all(
    signedTransactions.map((transaction) => getTransactionLifetime(transaction))
  )

  return raceRpcs(
    jitoRpcs,
    async (rpc, signal) => {
      const bundleId = await rpc.sendBundle(serializedTransactions).send({
        abortSignal: signal,
      })
      return confirmBundle({ rpc, signal, bundleId, lifetimes })
    },
    { timeoutMs: BRANCH_TIMEOUT_MS }
  )
}
