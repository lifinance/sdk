import BigNumber from 'bignumber.js'
import { constants, ContractTransaction, Signer } from 'ethers'
import { getApproved, setApproval } from '../allowance/utils'
import { Chain, Process, Step, Token } from '../types'
import { getProvider } from '../utils/getProvider'
import { parseError } from '../utils/parseError'
import { StatusManager } from './StatusManager'

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
  let allowanceProcess: Process = statusManager.findOrCreateProcess(
    'TOKEN_ALLOWANCE',
    step
  )

  // -> check allowance
  try {
    if (allowanceProcess.txHash) {
      allowanceProcess = statusManager.updateProcess(
        step,
        allowanceProcess.type,
        'PENDING'
      )
      await getProvider(signer).waitForTransaction(allowanceProcess!.txHash!)
      allowanceProcess = statusManager.updateProcess(
        step,
        allowanceProcess.type,
        'DONE'
      )
      // TODO: Do we need this check?
    } else if (allowanceProcess.status === 'DONE') {
      allowanceProcess = statusManager.updateProcess(
        step,
        allowanceProcess.type,
        'DONE'
      )
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
        allowanceProcess = statusManager.updateProcess(
          step,
          allowanceProcess.type,
          'PENDING',
          {
            txHash: approveTx.hash,
            txLink:
              chain.metamask.blockExplorerUrls[0] + 'tx/' + approveTx.hash,
          }
        )

        // wait for transcation
        await approveTx.wait()

        allowanceProcess = statusManager.updateProcess(
          step,
          allowanceProcess.type,
          'DONE'
        )
      } else {
        allowanceProcess = statusManager.updateProcess(
          step,
          allowanceProcess.type,
          'DONE'
        )
      }
    }
  } catch (e: any) {
    // -> set status
    if (e.code === 'TRANSACTION_REPLACED' && e.replacement) {
      await transactionReplaced(
        e.replacement,
        allowanceProcess,
        step,
        chain,
        statusManager
      )
    } else {
      const error = await parseError(e, step, allowanceProcess)
      allowanceProcess = statusManager.updateProcess(
        step,
        allowanceProcess.type,
        'FAILED',
        {
          error: {
            message: error.message,
            htmlMessage: error.htmlMessage,
            code: error.code,
          },
        }
      )
      statusManager.updateExecution(step, 'FAILED')
      throw error
    }
  }
}

const transactionReplaced = async (
  replacementTx: ContractTransaction,
  allowanceProcess: Process,
  step: Step,
  chain: Chain,
  statusManager: StatusManager
) => {
  try {
    allowanceProcess = statusManager.updateProcess(
      step,
      allowanceProcess.type,
      'PENDING',
      {
        txHash: replacementTx.hash,
        txLink:
          chain.metamask.blockExplorerUrls[0] + 'tx/' + replacementTx.hash,
      }
    )
    await replacementTx.wait()
    allowanceProcess = statusManager.updateProcess(
      step,
      allowanceProcess.type,
      'DONE'
    )
  } catch (e: any) {
    if (e.code === 'TRANSACTION_REPLACED' && e.replacement) {
      await transactionReplaced(
        e.replacement,
        allowanceProcess,
        step,
        chain,
        statusManager
      )
    }
    throw e
  }
}
