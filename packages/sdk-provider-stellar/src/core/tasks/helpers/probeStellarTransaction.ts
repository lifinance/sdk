import type { SDKClient } from '@lifi/sdk'
import { rpc } from '@stellar/stellar-sdk'
import { callStellarRpcsWithRetry } from '../../../client/getStellarRpc.js'

/**
 * What the network could tell us about a hash.
 *
 * `'not-found'` and `'unknown'` both mean "re-submit", but only `'not-found'`
 * is a definite answer. A re-submit error after `'unknown'` may come from a
 * transaction that in fact settled, so the caller must not report it.
 */
export type StellarTransactionProbe = 'landed' | 'not-found' | 'unknown'

/**
 * Asks whether the network already knows a transaction, without waiting for it.
 *
 * Soroban RPC only knows a transaction once it has been applied, so `NOT_FOUND`
 * stays ambiguous — never broadcast, or broadcast and still pending.
 */
export const probeStellarTransaction = async (
  client: SDKClient,
  transactionHash: string
): Promise<StellarTransactionProbe> => {
  try {
    const response = await callStellarRpcsWithRetry(client, (server) =>
      server.getTransaction(transactionHash)
    )
    return response.status === rpc.Api.GetTransactionStatus.NOT_FOUND
      ? 'not-found'
      : 'landed'
  } catch {
    return 'unknown'
  }
}
