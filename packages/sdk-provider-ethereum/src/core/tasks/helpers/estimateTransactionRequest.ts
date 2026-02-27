import type { SDKClient, TransactionParameters } from '@lifi/sdk'
import type { Address, Client, Hex } from 'viem'
import { estimateGas } from 'viem/actions'
import { getActionWithFallback } from '../../../utils/getActionWithFallback.js'

const GAS_ESTIMATION_BUFFER = 300_000n

export const estimateTransactionRequest = async (
  client: SDKClient,
  viemClient: Client,
  transactionRequest: TransactionParameters
) => {
  try {
    // Try to re-estimate the gas due to additional Permit data
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
    // Use the higher of estimated vs original, then add buffer
    const baseGas =
      transactionRequest.gas && transactionRequest.gas > estimatedGas
        ? transactionRequest.gas
        : estimatedGas

    transactionRequest.gas = baseGas + GAS_ESTIMATION_BUFFER
  } catch (_) {
    // If estimation fails, add buffer to existing gas limit
    if (transactionRequest.gas) {
      transactionRequest.gas = transactionRequest.gas + GAS_ESTIMATION_BUFFER
    }
  }

  return transactionRequest
}
