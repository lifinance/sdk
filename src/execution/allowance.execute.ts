import BigNumber from 'bignumber.js'
import { constants, Signer } from 'ethers'
import { getApproved, setApproval } from '../allowance/utils'
import StatusManager from '../StatusManager'
import { Chain, Step, Token } from '../types'
import { getProvider } from '../utils/getProvider'
import { parseWalletError } from '../utils/parseError'

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
    'TOKEN_ALLOWANCE',
    step,
    `Set Allowance for ${token.symbol}`
  )

  // -> check allowance
  try {
    if (allowanceProcess.txHash) {
      await getProvider(signer).waitForTransaction(allowanceProcess.txHash)
      statusManager.updateProcess(step, allowanceProcess.type, 'DONE')
    } else if (allowanceProcess.message === 'Already Approved') {
      statusManager.updateProcess(step, allowanceProcess.type, 'DONE')
    } else {
      const approved = await getApproved(signer, token.address, spenderAddress)

      if (new BigNumber(amount).gt(approved)) {
        if (!allowUserInteraction) {
          return
        }
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
        statusManager.updateProcess(step, allowanceProcess.type, 'PENDING', {
          txHash: approveTx.hash,
          txLink: chain.metamask.blockExplorerUrls[0] + 'tx/' + approveTx.hash,
          message: 'Approve - Wait for',
        })

        // wait for transcation
        await approveTx.wait()

        statusManager.updateProcess(step, allowanceProcess.type, 'DONE', {
          message: 'Approved: ',
        })
      } else {
        statusManager.updateProcess(step, allowanceProcess.type, 'DONE', {
          message: 'Already Approved',
        })
      }
    }
  } catch (e: any) {
    // -> set status
    if (e.code === 'TRANSACTION_REPLACED' && e.replacement) {
      statusManager.updateProcess(step, allowanceProcess.type, 'PENDING', {
        txHash: e.replacement.hash,
        txLink:
          chain.metamask.blockExplorerUrls[0] + 'tx/' + e.replacement.hash,
      })
    } else {
      const error = await parseWalletError(e, step, allowanceProcess)
      statusManager.updateProcess(step, allowanceProcess.type, 'FAILED', {
        errorMessage: error.message,
        htmlErrorMessage: error.htmlMessage,
        errorCode: error.code,
      })
      statusManager.updateExecution(step, 'FAILED')
      throw error
    }
  }
}
