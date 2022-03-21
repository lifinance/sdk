import { constants, Signer } from 'ethers'
import { Token } from '@lifinance/types'
import BigNumber from 'bignumber.js'
import { isZeroAddress } from '../utils/utils'
import { getApproved, setApproval } from './utils'

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
