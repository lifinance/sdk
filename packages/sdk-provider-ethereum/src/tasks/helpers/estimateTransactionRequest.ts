import type { SDKClient, TransactionParameters } from '@lifi/sdk'
import type { Address, Client, Hex } from 'viem'
import { estimateGas } from 'viem/actions'
import { getActionWithFallback } from '../../utils/getActionWithFallback.js'

/**
 * Re-estimate gas for permit flows; add 80k buffer on failure.
 */
export async function estimateTransactionRequest(
  client: SDKClient,
  viemClient: Client,
  transactionRequest: TransactionParameters
): Promise<TransactionParameters> {
  try {
    const estimatedGas = await getActionWithFallback(
      client,
      viemClient,
      estimateGas,
      'estimateGas',
      {
        account: viemClient.account!,
        to: transactionRequest.to as Address,
        data: transactionRequest.data as Hex,
        value: transactionRequest.value,
      }
    )
    transactionRequest.gas =
      transactionRequest.gas && transactionRequest.gas > estimatedGas
        ? transactionRequest.gas
        : estimatedGas
  } catch (_) {
    if (transactionRequest.gas) {
      transactionRequest.gas = transactionRequest.gas + 80_000n
    }
  }
  return transactionRequest
}
