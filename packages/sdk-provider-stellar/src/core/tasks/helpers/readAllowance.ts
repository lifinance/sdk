import { LiFiErrorCode, type SDKClient, TransactionError } from '@lifi/sdk'
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  scValToNative,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import { Api } from '@stellar/stellar-sdk/rpc'
import { callStellarRpcsWithRetry } from '../../../client/getStellarRpc.js'

/**
 * Reads the SAC `allowance(from, spender)` via read-only simulation.
 *
 * An absent or expired allowance entry reads back as `0`, so callers can treat
 * the result as a plain numeric comparison without a separate existence check.
 *
 * The simulation is the only part that goes through `callStellarRpcsWithRetry`;
 * the result is classified outside it, so a deterministic contract-level failure
 * is not retried against every RPC and is not buried in an `AggregateError`.
 */
export const readAllowance = async (
  client: SDKClient,
  token: string,
  from: string,
  spender: string,
  networkPassphrase: string
): Promise<bigint> => {
  // A zero-sequence account is sufficient for read-only simulation, and one
  // built envelope is reusable across servers because nothing about it is
  // server-specific.
  const source = new Account(from, '0')
  const transaction = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      new Contract(token).call(
        'allowance',
        Address.fromString(from).toScVal(),
        Address.fromString(spender).toScVal()
      )
    )
    .setTimeout(30)
    .build()

  // Only the transport call goes through the failover wrapper. It collapses
  // everything its callback throws into an `AggregateError`, so classifying
  // inside it would hide the error below from `parseStellarErrors`.
  const simulation = await callStellarRpcsWithRetry(client, (server) =>
    server.simulateTransaction(transaction)
  )

  // Fail rather than degrade to 0n: an unreadable allowance treated as "needs
  // approval" would prompt the user for an approval that cannot help.
  if (!Api.isSimulationSuccess(simulation) || !simulation.result) {
    throw new TransactionError(
      LiFiErrorCode.TransactionSimulationFailed,
      `Could not read the ${token} spending allowance for ${spender}${
        Api.isSimulationError(simulation) ? `: ${simulation.error}` : ''
      }`
    )
  }
  const allowance = scValToNative(simulation.result.retval)
  return allowance != null ? BigInt(allowance) : 0n
}
