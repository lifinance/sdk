import {
  assertNoOpenTransaction,
  BaseStepExecutionTask,
  CLEARED_TRANSACTION_FIELDS,
  LiFiErrorCode,
  relayTransaction,
  type SignedTypedData,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { Hash } from 'viem'
import { isHyperliquidAgentStep } from '../../hyperliquid/isHyperliquidAgentStep.js'
import { isNativePermitValid } from '../../permits/isNativePermitValid.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { isTypedDataAlreadySigned } from './helpers/isTypedDataAlreadySigned.js'
import { signHyperliquidTypedData } from './helpers/signHyperliquidTypedData.js'
import { signTypedDataEntries } from './helpers/signTypedDataEntries.js'

export class EthereumRelayedSignAndExecuteTask extends BaseStepExecutionTask {
  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
    const {
      step,
      client,
      statusManager,
      isBridgeExecution,
      signedTypedData: currentSignedTypedData,
    } = context

    const action = statusManager.findAction(
      step,
      isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )

    if (!action) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Action not found.'
      )
    }

    const allowanceTypedData = step.typedData?.filter(
      (typedData) =>
        !currentSignedTypedData.some((signedPermit) =>
          isNativePermitValid(signedPermit, typedData)
        )
    )
    if (!allowanceTypedData?.length) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Typed data for transfer is not found.'
      )
    }

    // An entry we already hold a signature for is relayed as it is.
    const unsignedTypedData = allowanceTypedData.filter(
      (typedData) =>
        !isTypedDataAlreadySigned(currentSignedTypedData, typedData)
    )

    // Checked again right before each signature: a late write of an older
    // run can merge its transaction into this action during the awaits
    // before it (strategy, chain switch, earlier prompts).
    const assertNoMergedTransaction = (): void =>
      assertNoOpenTransaction(statusManager.findAction(step, action.type))

    let signedTypedData: SignedTypedData[]
    if (isHyperliquidAgentStep(step)) {
      statusManager.updateAction(step, action.type, 'MESSAGE_REQUIRED')

      const signedResults = await signHyperliquidTypedData(
        context,
        unsignedTypedData,
        assertNoMergedTransaction
      )

      if (!signedResults) {
        return { status: 'PAUSED' }
      }

      signedTypedData = [...currentSignedTypedData, ...signedResults]
    } else {
      const result = await signTypedDataEntries(
        context,
        unsignedTypedData,
        action.type,
        'MESSAGE_REQUIRED',
        assertNoMergedTransaction
      )
      if (result.status === 'PAUSED') {
        return { status: 'PAUSED' }
      }
      signedTypedData = result.signedTypedData
    }

    // Checked once more after the wallet, also when every entry was signed
    // already: a stopped run's late write can merge its task id while a
    // prompt is open. Nothing awaits from here to `relayTransaction`. A
    // merge during the relay await is not caught: both are relayed, and the
    // write below replaces the merged task id.
    assertNoMergedTransaction()

    statusManager.updateAction(step, action.type, 'PENDING')

    const { execution, ...stepBase } = step
    const relayedTransaction = await relayTransaction(client, {
      ...stepBase,
      typedData: signedTypedData,
    })

    statusManager.updateAction(step, action.type, 'PENDING', {
      // A new transaction: nothing of the previous one may survive, least of
      // all its `txFinal` verdict.
      ...CLEARED_TRANSACTION_FIELDS,
      taskId: relayedTransaction.taskId as Hash,
      txType: 'relayed',
      txLink: relayedTransaction.txLink,
      signedAt: Date.now(),
    })

    return { status: 'COMPLETED', context: { signedTypedData } }
  }
}
