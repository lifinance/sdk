import type { SDKClient } from '@lifi/sdk'
import {
  Address,
  BASE_FEE,
  Contract,
  nativeToScVal,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import { callStellarRpcsWithRetry } from '../../../client/getStellarRpc.js'

/**
 * How long the granted allowance stays live, in ledgers. Ledgers close roughly
 * every 5s, so this is ~24h — far longer than the seconds between approving and
 * executing, but enough that a user who steps away mid-route doesn't have to
 * approve twice.
 */
const APPROVAL_TTL_LEDGERS = 17_280

/**
 * Builds and simulation-assembles a SAC `approve(from, spender, amount,
 * expiration_ledger)` transaction, returning the unsigned envelope XDR.
 *
 * Uses `prepareTransaction`, which simulates and folds the footprint, auth
 * entries and resource fee into the envelope in one step — the client-side
 * equivalent of what the backend's invocation builder does for route
 * transactions.
 */
export const buildApproveTransaction = async (
  client: SDKClient,
  token: string,
  from: string,
  spender: string,
  amount: bigint,
  networkPassphrase: string
): Promise<string> =>
  callStellarRpcsWithRetry(client, async (server) => {
    const [account, latestLedger] = await Promise.all([
      server.getAccount(from),
      server.getLatestLedger(),
    ])

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        new Contract(token).call(
          'approve',
          Address.fromString(from).toScVal(),
          Address.fromString(spender).toScVal(),
          nativeToScVal(amount, { type: 'i128' }),
          nativeToScVal(latestLedger.sequence + APPROVAL_TTL_LEDGERS, {
            type: 'u32',
          })
        )
      )
      .setTimeout(300)
      .build()

    const prepared = await server.prepareTransaction(transaction)
    return prepared.toXDR()
  })
