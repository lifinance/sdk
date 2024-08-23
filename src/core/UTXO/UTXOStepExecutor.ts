import type { Process } from '@lifi/types'
import type { Client } from 'viem'
import { getAddresses } from 'viem/actions'
import { LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError } from '../../errors/errors.js'
import { BaseStepExecutor } from '../BaseStepExecutor.js'
import type { LiFiStepExtended, StepExecutorOptions } from '../types.js'
import { parseUTXOErrors } from './parseUTXOErrors.js'

export interface UTXOStepExecutorOptions extends StepExecutorOptions {
  client: Client
}

export class UTXOStepExecutor extends BaseStepExecutor {
  private client: Client

  constructor(options: UTXOStepExecutorOptions) {
    super(options)
    this.client = options.client
  }

  // Ensure that we are using the right chain and wallet when executing transactions.
  checkClient = async (step: LiFiStepExtended, process?: Process) => {
    // Prevent execution of the quote by wallet different from the one which requested the quote
    let accountAddress = this.client.account?.address
    if (!accountAddress) {
      const accountAddresses = await getAddresses(this.client)
      accountAddress = accountAddresses?.[0]
    }
    if (accountAddress !== step.action.fromAddress) {
      let processToUpdate = process
      if (!processToUpdate) {
        // We need to create some process if we don't have one so we can show the error
        processToUpdate = this.statusManager.findOrCreateProcess(
          step,
          'TRANSACTION'
        )
      }
      const errorMessage =
        'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
      this.statusManager.updateProcess(step, processToUpdate.type, 'FAILED', {
        error: {
          code: LiFiErrorCode.WalletChangedDuringExecution,
          message: errorMessage,
        },
      })
      this.statusManager.updateExecution(step, 'FAILED')
      throw await parseUTXOErrors(
        new TransactionError(
          LiFiErrorCode.WalletChangedDuringExecution,
          errorMessage
        ),
        step,
        process
      )
    }
  }

  executeStep = async (step: LiFiStepExtended): Promise<LiFiStepExtended> => {
    return step
  }
}
