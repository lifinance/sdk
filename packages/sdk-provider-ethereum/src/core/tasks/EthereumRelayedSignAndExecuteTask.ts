import {
  BaseStepExecutionTask,
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

    const intentTypedData = step.typedData?.filter(
      (typedData) =>
        !currentSignedTypedData.some((signedPermit) =>
          isNativePermitValid(signedPermit, typedData)
        )
    )
    if (!intentTypedData?.length) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Typed data for transfer is not found.'
      )
    }

    let signedTypedData: SignedTypedData[]
    if (isHyperliquidAgentStep(step)) {
      statusManager.updateAction(step, action.type, 'MESSAGE_REQUIRED')

      const signedResults = await signHyperliquidTypedData(
        context,
        intentTypedData
      )

      if (!signedResults) {
        return { status: 'PAUSED' }
      }

      signedTypedData = [...currentSignedTypedData, ...signedResults]
    } else {
      // The same loop `EthereumCheckPermitsTask` and
      // `EthereumSignStepIntentTask` run, with this task's own status.
      // `MESSAGE_REQUIRED` is now emitted per entry rather than once, which is
      // idempotent: `StatusManager.updateAction` maps it to
      // `execution.status = 'ACTION_REQUIRED'` every time.
      const result = await signTypedDataEntries(
        context,
        intentTypedData,
        action.type,
        'MESSAGE_REQUIRED'
      )
      if (result.status === 'PAUSED') {
        return { status: 'PAUSED' }
      }
      signedTypedData = result.signedTypedData
    }

    statusManager.updateAction(step, action.type, 'PENDING')

    const { execution, ...stepBase } = step
    const relayedTransaction = await relayTransaction(client, {
      ...stepBase,
      typedData: signedTypedData,
    })

    statusManager.updateAction(step, action.type, 'PENDING', {
      taskId: relayedTransaction.taskId as Hash,
      txType: 'relayed',
      txLink: relayedTransaction.txLink,
      signedAt: Date.now(),
    })

    return { status: 'COMPLETED', context: { signedTypedData } }
  }
}
