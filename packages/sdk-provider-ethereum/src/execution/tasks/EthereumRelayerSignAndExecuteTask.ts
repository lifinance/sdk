import {
  BaseStepExecutionTask,
  type ExecutionAction,
  LiFiErrorCode,
  relayTransaction,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { Hash } from 'viem'
import { signTypedData } from 'viem/actions'
import { getAction } from 'viem/utils'
import { isNativePermitValid } from '../../permits/isNativePermitValid.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { getDomainChainId } from '../../utils/getDomainChainId.js'

export class EthereumRelayerSignAndExecuteTask extends BaseStepExecutionTask {
  override async shouldRun(
    context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<boolean> {
    return !context.isTransactionExecuted(action)
  }

  async run(
    context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<TaskResult> {
    const {
      step,
      fromChain,
      client,
      statusManager,
      allowUserInteraction,
      checkClient,
      signedTypedData,
    } = context
    const intentTypedData = step.typedData?.filter(
      (typedData) =>
        !signedTypedData.some((signedPermit) =>
          isNativePermitValid(signedPermit, typedData)
        )
    )
    if (!intentTypedData?.length) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Typed data for transfer is not found.'
      )
    }
    statusManager.updateAction(step, action.type, 'MESSAGE_REQUIRED')
    for (const typedData of intentTypedData) {
      if (!allowUserInteraction) {
        return { status: 'ACTION_REQUIRED' }
      }

      const typedDataChainId =
        getDomainChainId(typedData.domain) || fromChain.id

      // Switch to the typed data's chain if needed
      const updatedClient = await checkClient(step, action, typedDataChainId)
      if (!updatedClient) {
        return { status: 'ACTION_REQUIRED' }
      }

      const signature = await getAction(
        updatedClient,
        signTypedData,
        'signTypedData'
      )({
        account: updatedClient.account!,
        primaryType: typedData.primaryType,
        domain: typedData.domain,
        types: typedData.types,
        message: typedData.message,
      })
      signedTypedData.push({
        ...typedData,
        signature: signature,
      })
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

    context.signedTypedData = signedTypedData

    return { status: 'COMPLETED' }
  }
}
