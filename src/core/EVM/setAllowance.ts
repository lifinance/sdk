import type { Client, Hash, SendTransactionParameters } from 'viem'
import { encodeFunctionData } from 'viem'
import { sendTransaction } from 'viem/actions'
import { isNativeTokenAddress } from '../../utils/isZeroAddress.js'
import type { ExecutionOptions, TransactionParameters } from '../types.js'
import { approveAbi } from './abi.js'
import { getAllowance } from './getAllowance.js'
import type { ApproveTokenRequest, RevokeApprovalRequest } from './types.js'
import { getMaxPriorityFeePerGas } from './utils.js'

export const setAllowance = async (
  client: Client,
  tokenAddress: string,
  contractAddress: string,
  amount: bigint,
  settings?: ExecutionOptions,
  returnPopulatedTransaction?: boolean
): Promise<Hash> => {
  const data = encodeFunctionData({
    abi: approveAbi,
    functionName: 'approve',
    args: [contractAddress, amount],
  })

  if (returnPopulatedTransaction) {
    return data
  }

  let transactionRequest: TransactionParameters = {
    to: tokenAddress,
    data,
    maxPriorityFeePerGas:
      client.account?.type === 'local'
        ? await getMaxPriorityFeePerGas(client)
        : undefined,
  }

  if (settings?.updateTransactionRequestHook) {
    const customizedTransactionRequest: TransactionParameters =
      await settings.updateTransactionRequestHook({
        requestType: 'approve',
        ...transactionRequest,
      })

    transactionRequest = {
      ...transactionRequest,
      ...customizedTransactionRequest,
    }
  }

  return sendTransaction(client, {
    to: transactionRequest.to,
    account: client.account!,
    data: transactionRequest.data,
    gas: transactionRequest.gas,
    gasPrice: transactionRequest.gasPrice,
    maxFeePerGas: transactionRequest.maxFeePerGas,
    maxPriorityFeePerGas: transactionRequest.maxPriorityFeePerGas,
    chain: null,
  } as SendTransactionParameters)
}

/**
 * Set approval for a certain token and amount.
 * @param request - The approval request
 * @param request.walletClient - The Viem wallet client used to send the transaction
 * @param request.token - The token for which to set the allowance
 * @param request.spenderAddress - The address of the spender
 * @param request.amount - The amount of tokens to approve
 * @returns Returns Hash or nothing
 */
export const setTokenAllowance = async ({
  walletClient,
  token,
  spenderAddress,
  amount,
}: ApproveTokenRequest): Promise<Hash | void> => {
  // native token don't need approval
  if (isNativeTokenAddress(token.address)) {
    return
  }
  const approvedAmount = await getAllowance(
    token.chainId,
    token.address,
    walletClient.account!.address,
    spenderAddress
  )

  if (amount > approvedAmount) {
    const approveTx = await setAllowance(
      walletClient,
      token.address,
      spenderAddress,
      amount
    )

    return approveTx
  }
}

/**
 * Revoke approval for a certain token.
 * @param request - The revoke request
 * @param request.walletClient - The Viem wallet client used to send the transaction
 * @param request.token - The token for which to revoke the allowance
 * @param request.spenderAddress - The address of the spender
 * @returns Returns Hash or nothing
 */
export const revokeTokenApproval = async ({
  walletClient,
  token,
  spenderAddress,
}: RevokeApprovalRequest): Promise<Hash | void> => {
  // native token don't need approval
  if (isNativeTokenAddress(token.address)) {
    return
  }
  const approvedAmount = await getAllowance(
    token.chainId,
    token.address,
    walletClient.account!.address,
    spenderAddress
  )
  if (approvedAmount > 0) {
    const approveTx = await setAllowance(
      walletClient,
      token.address,
      spenderAddress,
      0n
    )

    return approveTx
  }
}
