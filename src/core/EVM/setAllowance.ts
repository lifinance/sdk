import type {
  Hash,
  PublicClient,
  SendTransactionParameters,
  WalletClient,
} from 'viem'
import { encodeFunctionData, maxUint256, publicActions } from 'viem'
import { isNativeTokenAddress } from '../../utils/utils.js'
import type { ExecutionOptions, TransactionParameters } from '../types.js'
import { approveAbi } from './abi.js'
import { getAllowance } from './getAllowance.js'
import type { ApproveTokenRequest, RevokeApprovalRequest } from './types.js'
import { getMaxPriorityFeePerGas } from './utils.js'

export const setAllowance = async (
  walletClient: WalletClient,
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
  const client = walletClient.extend(publicActions)

  let transactionRequest: TransactionParameters = {
    to: tokenAddress,
    data,
    maxPriorityFeePerGas:
      walletClient.account?.type === 'local'
        ? await getMaxPriorityFeePerGas(client as PublicClient)
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

  return client.sendTransaction({
    to: transactionRequest.to,
    account: walletClient.account!,
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
 * @param request.walletClient
 * @param request.token
 * @param request.spenderAddress
 * @param request.amount
 * @param request.infiniteApproval
 * @returns Returns Hash or nothing
 */
export const setTokenAllowance = async ({
  walletClient,
  token,
  spenderAddress,
  amount,
  infiniteApproval = false,
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
    const approvalAmount = infiniteApproval ? maxUint256 : amount

    const approveTx = await setAllowance(
      walletClient,
      token.address,
      spenderAddress,
      approvalAmount
    )

    return approveTx
  }
}

/**
 * Revoke approval for a certain token.
 * @param request - The revoke request
 * @param request.walletClient
 * @param request.token
 * @param request.spenderAddress
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
