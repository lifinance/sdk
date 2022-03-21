import { constants, Signer } from 'ethers'
import { Token } from '@lifinance/types'
import { RevokeTokenData } from '../types'
import BigNumber from 'bignumber.js'
import { isZeroAddress } from '../utils/utils'
import {
  getAllowanceViaMulticall,
  getApproved,
  groupByChain,
  setApproval,
} from './utils'
import { isSameToken } from '../helpers'

export const getTokenApproval = async (
  signer: Signer,
  token: Token,
  approvalAddress: string
): Promise<string | undefined> => {
  // native token don't need approval
  if (isZeroAddress(token.address)) {
    return
  }

  const approved = await getApproved(signer, token.address, approvalAddress)
  return approved.toString()
}

export const bulkGetTokenApproval = async (
  signer: Signer,
  tokenData: RevokeTokenData[]
): Promise<{ token: Token; approval: string | undefined }[]> => {
  // filter out native tokens
  const filteredTokenData = tokenData.filter(
    ({ token }) => !isZeroAddress(token.address)
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
    if (isZeroAddress(token.address)) {
      return { token, approval: undefined }
    }

    const approved = approvals.find((approval) =>
      isSameToken(approval.token, token)
    )

    return { token, approval: approved?.approvedAmount.toString() ?? undefined }
  })
}

export const approveToken = async (
  signer: Signer,
  token: Token,
  approvalAddress: string,
  amount: string,
  infiniteApproval = false
): Promise<void> => {
  // native token don't need approval
  if (isZeroAddress(token.address)) {
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

    await approveTx.wait()
  }
}

export const revokeTokenApproval = async (
  signer: Signer,
  token: Token,
  approvalAddress: string
): Promise<void> => {
  // native token don't need approval
  if (isZeroAddress(token.address)) {
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

    await approveTx.wait()
  }
}
