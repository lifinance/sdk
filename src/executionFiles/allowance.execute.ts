import BigNumber from 'bignumber.js'
import { constants, Signer } from 'ethers'
import { StatusManager } from '..'

import { Chain, Execution, Step, Token } from '../types'
import { getApproved, setApproval } from '../utils'

export const checkAllowance = async (
  signer: Signer,
  step: Step,
  chain: Chain,
  token: Token,
  amount: string,
  spenderAddress: string,
  statusManager: StatusManager,
  update: (execution: Execution) => void,
  status: Execution,
  infiniteApproval = false
  // eslint-disable-next-line max-params
) => {
  // Ask user to set allowance
  // -> set status
  const allowanceProcess = statusManager.createAndPushProcess(
    'allowanceProcess',
    update,
    status,
    `Set Allowance for ${token.symbol}`
  )

  // -> check allowance
  try {
    if (allowanceProcess.txHash) {
      await signer.provider!.waitForTransaction(allowanceProcess.txHash)
      statusManager.setStatusDone(update, status, allowanceProcess)
    } else if (allowanceProcess.message === 'Already Approved') {
      statusManager.setStatusDone(update, status, allowanceProcess)
    } else {
      const approved = await getApproved(signer, token.address, spenderAddress)

      if (new BigNumber(amount).gt(approved)) {
        const approvaLAmount = infiniteApproval
          ? constants.MaxUint256.toString()
          : amount
        const approveTx = await setApproval(
          signer,
          token.address,
          spenderAddress,
          approvaLAmount
        )

        // update status
        allowanceProcess.status = 'PENDING'
        allowanceProcess.txHash = approveTx.hash
        allowanceProcess.txLink =
          chain.metamask.blockExplorerUrls[0] + 'tx/' + allowanceProcess.txHash
        allowanceProcess.message = 'Approve - Wait for'
        update(status)

        // wait for transcation
        await approveTx.wait()

        // -> set status
        allowanceProcess.message = 'Approved:'
      } else {
        allowanceProcess.message = 'Already Approved'
      }
      statusManager.setStatusDone(update, status, allowanceProcess)
    }
  } catch (e: any) {
    // -> set status
    if (e.message) allowanceProcess.errorMessage = e.message
    if (e.code) allowanceProcess.errorCode = e.code
    statusManager.setStatusFailed(update, status, allowanceProcess)
    throw e
  }
}
