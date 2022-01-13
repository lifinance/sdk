import BigNumber from 'bignumber.js'
import { constants, Signer } from 'ethers'
import StatusManager from '../StatusManager'
import { parseWalletError } from '../utils/parseError'

import { Chain, Step, Token } from '../types'
import { getApproved, setApproval } from '../utils'

export const checkAllowance = async (
  signer: Signer,
  step: Step,
  chain: Chain,
  token: Token,
  amount: string,
  spenderAddress: string,
  statusManager: StatusManager,
  infiniteApproval = false
  // eslint-disable-next-line max-params
) => {
  // Ask user to set allowance
  // -> set currentExecution
  const allowanceProcess = statusManager.findOrCreateProcess(
    'allowanceProcess',
    step,
    `Set Allowance for ${token.symbol}`
  )

  // -> check allowance
  try {
    if (allowanceProcess.txHash) {
      await signer.provider!.waitForTransaction(allowanceProcess.txHash)
      statusManager.updateProcess(step, allowanceProcess.id, 'DONE')
    } else if (allowanceProcess.message === 'Already Approved') {
      statusManager.updateProcess(step, allowanceProcess.id, 'DONE')
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

        // update currentExecution
        statusManager.updateProcess(step, allowanceProcess.id, 'PENDING', {
          txHash: approveTx.hash,
          txLink: chain.metamask.blockExplorerUrls[0] + 'tx/' + approveTx.hash,
          message: 'Approve - Wait for',
        })

        // wait for transcation
        await approveTx.wait()

        statusManager.updateProcess(step, allowanceProcess.id, 'DONE', {
          message: 'Approved: ',
        })
      } else {
        statusManager.updateProcess(step, allowanceProcess.id, 'DONE', {
          message: 'Already Approved',
        })
      }
    }
  } catch (e: any) {
    // -> set status
    if (e.code === 'TRANSACTION_REPLACED' && e.replacement) {
      statusManager.updateProcess(step, allowanceProcess.id, 'PENDING', {
        txHash: e.replacement.hash,
        txLink:
          chain.metamask.blockExplorerUrls[0] + 'tx/' + e.replacement.hash,
      })
    } else {
      const error = parseWalletError(e)
      statusManager.updateProcess(step, allowanceProcess.id, 'FAILED', {
        errorMessage: error.message,
        errorCode: error.code,
      })
      statusManager.updateExecution(step, 'FAILED')
      throw error
    }
  }
}
