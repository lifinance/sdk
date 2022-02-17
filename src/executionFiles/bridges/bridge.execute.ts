import { TransactionResponse } from '@ethersproject/abstract-provider'
import { constants } from 'ethers'

import Lifi from '../../Lifi'
import { parseWalletError } from '../../utils/parseError'
import { ExecuteCrossParams, getChainById } from '../../types'
import { personalizeStep, repeatUntilDone } from '../../utils/utils'
import { checkAllowance } from '../allowance.execute'
import { balanceCheck } from '../balanceCheck.execute'
import {
  BridgeTool,
  ChainId,
  Execution,
  StatusResponse,
} from '@lifinance/types'
import { getProvider } from '../../utils/getProvider'
import { switchChain } from '../switchChain'
import { LifiErrorCodes, ServerError } from '../../utils/errors'

export class BridgeExecutionManager {
  shouldContinue = true

  setShouldContinue = (val: boolean): void => {
    this.shouldContinue = val
  }

  execute = async ({
    signer,
    step,
    statusManager,
    hooks,
  }: ExecuteCrossParams): Promise<Execution> => {
    const { action, estimate } = step
    step.execution = statusManager.initExecutionObject(step)
    const fromChain = getChainById(action.fromChainId)
    const toChain = getChainById(action.toChainId)

    // STEP 1: Check Allowance ////////////////////////////////////////////////
    // approval still needed?
    const oldCrossProcess = step.execution.process.find(
      (p) => p.id === 'crossProcess'
    )
    if (!oldCrossProcess || !oldCrossProcess.txHash) {
      if (action.fromToken.address !== constants.AddressZero) {
        // Check Token Approval only if fromToken is not the native token => no approval needed in that case
        await checkAllowance(
          signer,
          step,
          fromChain,
          action.fromToken,
          action.fromAmount,
          estimate.approvalAddress,
          statusManager,
          true,
          this.shouldContinue
        )
      }
    }

    // STEP 2: Get Transaction ////////////////////////////////////////////////
    const crossProcess = statusManager.findOrCreateProcess(
      'crossProcess',
      step,
      'Prepare Transaction'
    )

    try {
      let tx: TransactionResponse
      if (crossProcess.txHash) {
        // load exiting transaction
        tx = await getProvider(signer).getTransaction(crossProcess.txHash)
      } else {
        // check balance
        await balanceCheck(signer, step)

        // create new transaction
        const personalizedStep = await personalizeStep(signer, step)
        const { transactionRequest } = await Lifi.getStepTransaction(
          personalizedStep
        )
        if (!transactionRequest) {
          statusManager.updateProcess(step, crossProcess.id, 'FAILED', {
            errorMessage: 'Unable to prepare Transaction',
          })
          statusManager.updateExecution(step, 'FAILED')
          throw new ServerError(crossProcess.errorMessage)
        }

        // STEP 3: Send Transaction ///////////////////////////////////////////////
        // make sure that chain is still correct
        const updatedSigner = await switchChain(
          signer,
          statusManager,
          step,
          hooks.switchChainHook,
          this.shouldContinue
        )

        if (!updatedSigner) {
          // chain switch was not successful, stop execution here
          return step.execution
        }

        signer = updatedSigner

        statusManager.updateProcess(step, crossProcess.id, 'ACTION_REQUIRED')
        if (!this.shouldContinue) return step.execution

        tx = await signer.sendTransaction(transactionRequest)

        // STEP 4: Wait for Transaction ///////////////////////////////////////////
        statusManager.updateProcess(step, crossProcess.id, 'PENDING', {
          txHash: tx.hash,
          txLink: fromChain.metamask.blockExplorerUrls[0] + 'tx/' + tx.hash,
        })
      }

      await tx.wait()
    } catch (e: any) {
      if (e.code === 'TRANSACTION_REPLACED' && e.replacement) {
        statusManager.updateProcess(step, crossProcess.id, 'PENDING', {
          txHash: e.replacement.hash,
          txLink:
            fromChain.metamask.blockExplorerUrls[0] +
            'tx/' +
            e.replacement.hash,
        })
      } else {
        const error = parseWalletError(e, step, crossProcess)
        statusManager.updateProcess(step, crossProcess.id, 'FAILED', {
          errorMessage: error.message,
          htmlErrorMessage: error.htmlMessage,
          errorCode: error.code,
        })
        statusManager.updateExecution(step, 'FAILED')
        throw error
      }
    }

    statusManager.updateProcess(step, crossProcess.id, 'DONE', {
      message: 'Transfer started: ',
    })

    // STEP 5: Wait for Receiver //////////////////////////////////////
    const waitForTxProcess = statusManager.findOrCreateProcess(
      'waitForTxProcess',
      step,
      'Wait for Receiving Chain'
    )
    let statusResponse: StatusResponse
    try {
      statusResponse = await this.waitForReceivingTransaction(
        step.tool as BridgeTool,
        fromChain.id,
        toChain.id,
        crossProcess.txHash
      )
    } catch (e: any) {
      statusManager.updateProcess(step, waitForTxProcess.id, 'FAILED', {
        errorMessage: 'Failed waiting',
        errorCode: e.code,
      })
      statusManager.updateExecution(step, 'FAILED')
      throw e
    }

    statusManager.updateProcess(step, waitForTxProcess.id, 'DONE', {
      txHash: statusResponse.receiving?.txHash,
      txLink:
        toChain.metamask.blockExplorerUrls[0] +
        'tx/' +
        statusResponse.receiving?.txHash,
      message: 'Funds Received:',
    })

    statusManager.updateExecution(step, 'DONE', {
      fromAmount: statusResponse.sending.amount,
      toAmount: statusResponse.receiving?.amount,
      // gasUsed: statusResponse.gasUsed,
    })

    // DONE
    return step.execution
  }

  private async waitForReceivingTransaction(
    tool: BridgeTool,
    fromChainId: ChainId,
    toChainId: ChainId,
    txHash: string
  ): Promise<StatusResponse> {
    const getStatus = (): Promise<StatusResponse | undefined> =>
      new Promise(async (resolve, reject) => {
        let statusResponse: StatusResponse
        try {
          statusResponse = await Lifi.getStatus(
            tool,
            fromChainId,
            toChainId,
            txHash
          )
        } catch (e: any) {
          // until the source transaction is mined the API will return a 404
          if (e.code === LifiErrorCodes.notFound) {
            return resolve(undefined)
          }

          return reject(e)
        }

        switch (statusResponse.status) {
          case 'DONE':
            return resolve(statusResponse)
          case 'PENDING':
            return resolve(undefined)
          case 'FAILED':
          default:
            return reject()
        }
      })

    const status = await repeatUntilDone(getStatus, 5_000)

    if (!status.receiving) {
      throw new ServerError('Status does not contain receiving information')
    }

    return status
  }
}
