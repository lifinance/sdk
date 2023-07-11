import { Token } from '@lifi/types'
import BigNumber from 'bignumber.js'
import { constants, ContractTransaction, Signer } from 'ethers'
import { isSameToken } from '../helpers'
import { RevokeTokenData } from '../types'
import { isNativeTokenAddress } from '../utils/utils'
import {
  getAllowanceViaMulticall,
  getApproved,
  groupByChain,
  setApproval,
} from './utils'

export interface ApproveTokenRequest {
  signer: Signer
  token: Token
  approvalAddress: string
  amount: string
  infiniteApproval?: boolean
}

export interface RevokeApprovalRequest {
  signer: Signer
  token: Token
  approvalAddress: string
}

export const getTokenApproval = async (
  signer: Signer,
  token: Token,
  approvalAddress: string
): Promise<string | undefined> => {
  // native token don't need approval
  if (isNativeTokenAddress(token.address)) {
    return
  }

  const approved = await getApproved(signer, token.address, approvalAddress)
  return approved.toFixed(0)
}

export const bulkGetTokenApproval = async (
  signer: Signer,
  tokenData: RevokeTokenData[]
): Promise<{ token: Token; approval: string | undefined }[]> => {
  // filter out native tokens
  const filteredTokenData = tokenData.filter(
    ({ token }) => !isNativeTokenAddress(token.address)
  )

  // group by chain
  const tokenDataByChain = groupByChain(filteredTokenData)

  const approvalPromises = Object.keys(tokenDataByChain).map(
    async (chainId) => {
      const parsedChainId = Number.parseInt(chainId)

      // get allowances for current chain and token list
      return getAllowanceViaMulticall(
        signer,
        parsedChainId,
        tokenDataByChain[parsedChainId]
      )
    }
  )

  const approvalsByChain = await Promise.all(approvalPromises)
  const approvals = approvalsByChain.flat()
  return tokenData.map(({ token }) => {
    // native token don't need approval
    if (isNativeTokenAddress(token.address)) {
      return { token, approval: undefined }
    }

    const approved = approvals.find((approval) =>
      isSameToken(approval.token, token)
    )

    return { token, approval: approved?.approvedAmount.toString() }
  })
}

export const approveToken = async ({
  signer,
  token,
  approvalAddress,
  amount,
  infiniteApproval = false,
}: ApproveTokenRequest): Promise<void> => {
  // native token don't need approval
  if (isNativeTokenAddress(token.address)) {
    return
  }

  const approvedAmount = await getApproved(
    signer,
    token.address,
    approvalAddress
  )

  if (new BigNumber(amount).gt(approvedAmount)) {
    const approvalAmount = infiniteApproval
      ? constants.MaxUint256.toString()
      : amount

    const approveTx = await setApproval(
      signer,
      token.address,
      approvalAddress,
      approvalAmount
    )

    await (approveTx as ContractTransaction).wait()
  }
}

export const revokeTokenApproval = async ({
  signer,
  token,
  approvalAddress,
}: RevokeApprovalRequest): Promise<void> => {
  // native token don't need approval
  if (isNativeTokenAddress(token.address)) {
    return
  }

  const approvedAmount = await getApproved(
    signer,
    token.address,
    approvalAddress
  )
  if (!approvedAmount.isZero()) {
    const approveTx = await setApproval(
      signer,
      token.address,
      approvalAddress,
      '0'
    )

    await (approveTx as ContractTransaction).wait()
  }
}
