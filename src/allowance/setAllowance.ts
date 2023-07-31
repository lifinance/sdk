import type { Address, Hash, PublicClient, WalletClient } from 'viem'
import { encodeFunctionData, publicActions } from 'viem'
import { MaxUint256 } from '../constants'
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
  let maxPriorityFeePerGas: bigint | undefined
  if (walletClient.account?.type === 'local') {
    maxPriorityFeePerGas = await getMaxPriorityFeePerGas(client as PublicClient)
  }

  return client.sendTransaction({
    to: tokenAddress as Address,
    account: walletClient.account!,
    data,
    maxPriorityFeePerGas,
    chain: null,
  })
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
    const approvalAmount = infiniteApproval ? MaxUint256 : amount

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
