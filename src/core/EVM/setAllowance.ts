import type { Address, Client, Hash, SendTransactionParameters } from 'viem'
import { encodeFunctionData } from 'viem'
import { sendTransaction } from 'viem/actions'
import { getAction } from 'viem/utils'
import { isZeroAddress } from '../../utils/isZeroAddress.js'
import type {
  ExecutionOptions,
  SDKClient,
  TransactionParameters,
} from '../types.js'
import { approveAbi } from './abi.js'
import { getAllowance } from './getAllowance.js'
import type { ApproveTokenRequest, RevokeApprovalRequest } from './types.js'
import { getMaxPriorityFeePerGas } from './utils.js'

export const setAllowance = async (
  client: SDKClient,
  viemClient: Client,
  tokenAddress: Address,
  contractAddress: Address,
  amount: bigint,
  executionOptions?: ExecutionOptions,
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
      viemClient.account?.type === 'local'
        ? await getMaxPriorityFeePerGas(client, viemClient)
        : undefined,
  }

  if (executionOptions?.updateTransactionRequestHook) {
    const customizedTransactionRequest: TransactionParameters =
      await executionOptions.updateTransactionRequestHook({
        requestType: 'approve',
        ...transactionRequest,
      })

    transactionRequest = {
      ...transactionRequest,
      ...customizedTransactionRequest,
    }
  }

  return getAction(
    viemClient,
    sendTransaction,
    'sendTransaction'
  )({
    to: transactionRequest.to,
    account: viemClient.account!,
    data: transactionRequest.data,
    gas: transactionRequest.gas,
    gasPrice: transactionRequest.gasPrice,
    maxFeePerGas: transactionRequest.maxFeePerGas,
    maxPriorityFeePerGas: transactionRequest.maxPriorityFeePerGas,
  } as SendTransactionParameters)
}

/**
 * Set approval for a certain token and amount.
 * @param client - The SDK client
 * @param request - The approval request
 * @param request.walletClient - The Viem wallet client used to send the transaction
 * @param request.token - The token for which to set the allowance
 * @param request.spenderAddress - The address of the spender
 * @param request.amount - The amount of tokens to approve
 * @returns Returns Hash or nothing
 */
export const setTokenAllowance = async (
  client: SDKClient,
  { walletClient, token, spenderAddress, amount }: ApproveTokenRequest
): Promise<Hash | void> => {
  // native token don't need approval
  if (isZeroAddress(token.address)) {
    return
  }
  const approvedAmount = await getAllowance(
    client,
    walletClient,
    token.address as Address,
    walletClient.account!.address,
    spenderAddress as Address
  )

  if (amount > approvedAmount) {
    const approveTx = await setAllowance(
      client,
      walletClient,
      token.address as Address,
      spenderAddress as Address,
      amount
    )

    return approveTx
  }
}

/**
 * Revoke approval for a certain token.
 * @param client - The SDK client
 * @param request - The revoke request
 * @param request.walletClient - The Viem wallet client used to send the transaction
 * @param request.token - The token for which to revoke the allowance
 * @param request.spenderAddress - The address of the spender
 * @returns Returns Hash or nothing
 */
export const revokeTokenApproval = async (
  client: SDKClient,
  { walletClient, token, spenderAddress }: RevokeApprovalRequest
): Promise<Hash | void> => {
  // native token don't need approval
  if (isZeroAddress(token.address)) {
    return
  }
  const approvedAmount = await getAllowance(
    client,
    walletClient,
    token.address as Address,
    walletClient.account!.address,
    spenderAddress as Address
  )
  if (approvedAmount > 0) {
    const approveTx = await setAllowance(
      client,
      walletClient,
      token.address as Address,
      spenderAddress as Address,
      0n
    )

    return approveTx
  }
}
