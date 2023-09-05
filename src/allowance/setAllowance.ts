import type {
  Address,
  Hash,
  PublicClient,
  SendTransactionParameters,
  WalletClient,
} from 'viem'
import { encodeFunctionData, maxUint256, publicActions } from 'viem'
import type {
  InternalExecutionSettings,
  TransactionParameters,
} from '../execution/types'
import { approveAbi } from '../types'
import { getMaxPriorityFeePerGas } from '../utils'
import { isNativeTokenAddress } from '../utils/utils'
import { getAllowance } from './getAllowance'
import type { ApproveTokenRequest, RevokeApprovalRequest } from './types'

export const setAllowance = async (
  walletClient: WalletClient,
  tokenAddress: string,
  contractAddress: string,
  amount: bigint,
  settings?: InternalExecutionSettings,
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
    to: transactionRequest.to as Address,
    account: walletClient.account!,
    data: transactionRequest.data,
    gas: transactionRequest.gas,
    gasPrice: transactionRequest.gasPrice,
    maxFeePerGas: transactionRequest.maxFeePerGas,
    maxPriorityFeePerGas: transactionRequest.maxPriorityFeePerGas,
    chain: null,
  } as SendTransactionParameters)
}

export const setTokenAllowance = async ({
  walletClient,
  token,
  spenderAddress,
  amount,
  infiniteApproval = false,
}: ApproveTokenRequest): Promise<Hash | undefined> => {
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

export const revokeTokenApproval = async ({
  walletClient,
  token,
  spenderAddress,
}: RevokeApprovalRequest): Promise<Hash | undefined> => {
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
