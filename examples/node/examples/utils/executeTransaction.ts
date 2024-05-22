import type { Address, Hash } from 'viem'
import type { TransactionRequest } from '@lifi/sdk'
import type { WalletClientWithPublicActions } from '../types'

export const executeTransaction = async (
  client: WalletClientWithPublicActions,
  transactionRequest: TransactionRequest
) => {
  console.info('>> Execute transaction', transactionRequest)

  const hash = await client.sendTransaction({
    to: transactionRequest.to as Address,
    account: client.account!,
    value: transactionRequest.value
      ? BigInt(transactionRequest.value as string)
      : undefined,
    data: transactionRequest.data as Hash,
    gas: transactionRequest.gasLimit
      ? BigInt(transactionRequest.gasLimit as string)
      : undefined,
    gasPrice: transactionRequest.gasPrice
      ? BigInt(transactionRequest.gasPrice as string)
      : undefined,
    maxFeePerGas: transactionRequest.maxFeePerGas
      ? BigInt(transactionRequest.maxFeePerGas as string)
      : undefined,
    maxPriorityFeePerGas: transactionRequest.maxPriorityFeePerGas
      ? BigInt(transactionRequest.maxPriorityFeePerGas as string)
      : undefined,
    kzg: undefined,
    chain: null,
  })

  console.info('>> Transaction sent', hash)

  const transactionReceipt = await client.getTransactionReceipt({
    hash,
  })

  console.info('>> Transaction receipt', transactionReceipt)

  return transactionReceipt
}
