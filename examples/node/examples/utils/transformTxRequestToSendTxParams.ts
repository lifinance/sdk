import type { TransactionRequest } from '@lifi/sdk'
import type { Address, Hash } from 'viem'
import type { PrivateKeyAccount, SendTransactionParameters } from 'viem'

export const transformTxRequestToSendTxParams = (
  account: PrivateKeyAccount,
  txRequest?: TransactionRequest
): SendTransactionParameters => {
  if (!txRequest) {
    throw new Error(
      'transformTxRequestToSendTx: A transaction request was not provided'
    )
  }

  return {
    to: txRequest.to as Address,
    account,
    data: txRequest.data as Hash,
    value: txRequest.value ? BigInt(txRequest.value) : undefined,
    gas: txRequest.gasLimit ? BigInt(txRequest.gasLimit as string) : undefined,
    gasPrice: txRequest.gasPrice
      ? BigInt(txRequest.gasPrice as string)
      : undefined,
    chain: null,
  }
}
