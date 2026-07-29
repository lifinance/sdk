import { LiFiErrorCode, type SDKClient, TransactionError } from '@lifi/sdk'
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  rpc,
  scValToNative,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import { callStellarRpcsWithRetry } from '../../../client/getStellarRpc.js'

/**
 * Reads the SAC `allowance(from, spender)` via read-only simulation.
 *
 * An absent or expired allowance entry reads back as `0`, so callers can treat
 * the result as a plain numeric comparison without a separate existence check.
 */
export const readAllowance = async (
  client: SDKClient,
  token: string,
  from: string,
  spender: string,
  networkPassphrase: string
): Promise<bigint> =>
  callStellarRpcsWithRetry(client, async (server) => {
    // A zero-sequence account is sufficient for read-only simulation.
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

    const simulation = await server.simulateTransaction(transaction)
    // Fail rather than degrade to 0n: an unreadable allowance treated as "needs
    // approval" would prompt the user for an approval that cannot help.
    // Classified here rather than left as a bare Error so parseStellarErrors
    // passes it through untouched instead of pattern-matching the message.
    if (!rpc.Api.isSimulationSuccess(simulation) || !simulation.result) {
      throw new TransactionError(
        LiFiErrorCode.TransactionSimulationFailed,
        `Could not read the ${token} spending allowance for ${spender}${
          rpc.Api.isSimulationError(simulation) ? `: ${simulation.error}` : ''
        }`
      )
    }
    const allowance = scValToNative(simulation.result.retval)
    return allowance != null ? BigInt(allowance) : 0n
  })
