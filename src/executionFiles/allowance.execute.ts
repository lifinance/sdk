import BigNumber from 'bignumber.js'
import { constants, Signer } from 'ethers'
import StatusManager from '../StatusManager'
import { parseWalletError } from '../utils/parseError'
import { getApproved, setApproval } from '../utils/utils'
import { Chain, Step, Token } from '../types'
import { getProvider } from '../utils/getProvider'

export const checkAllowance = async (
  signer: Signer,
  step: Step,
  chain: Chain,
  token: Token,
  amount: string,
  spenderAddress: string,
  statusManager: StatusManager,
  infiniteApproval = false,
  allowUserInteraction = false
  // eslint-disable-next-line max-params
): Promise<void> => {
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
      await getProvider(signer).waitForTransaction(allowanceProcess.txHash)
      statusManager.updateProcess(step, allowanceProcess.id, 'DONE')
    } else if (allowanceProcess.message === 'Already Approved') {
      statusManager.updateProcess(step, allowanceProcess.id, 'DONE')
    } else {
      const approved = await getApproved(signer, token.address, spenderAddress)

      if (new BigNumber(amount).gt(approved)) {
        if (!allowUserInteraction) return
        const approvalAmount = infiniteApproval
          ? constants.MaxUint256.toString()
          : amount
        const approveTx = await setApproval(
          signer,
          token.address,
          spenderAddress,
          approvalAmount
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
      const error = parseWalletError(e, step, allowanceProcess)
      statusManager.updateProcess(step, allowanceProcess.id, 'FAILED', {
        errorMessage: error.message,
        htmlErrorMessage: error.htmlMessage,
        errorCode: error.code,
      })
      statusManager.updateExecution(step, 'FAILED')
      throw error
    }
  }
}
