import {
  BaseStepExecutionTask,
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

export class EthereumRelayedSignAndExecuteTask extends BaseStepExecutionTask {
  static override readonly name = 'ETHEREUM_RELAYED_SIGN_AND_EXECUTE' as const
  override readonly taskName = EthereumRelayedSignAndExecuteTask.name

  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
    const {
      step,
      fromChain,
      client,
      statusManager,
      allowUserInteraction,
      checkClient,
      isBridgeExecution,
      tasksResults,
    } = context

    const signedTypedData = [...tasksResults.signedTypedData]

    const action = statusManager.findAction(
      step,
      isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )

    if (!action) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction.'
      )
    }

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
        return { status: 'PAUSED' }
      }

      const typedDataChainId =
        getDomainChainId(typedData.domain) || fromChain.id

      // Switch to the typed data's chain if needed
      const updatedClient = await checkClient(step, typedDataChainId)
      if (!updatedClient) {
        return { status: 'PAUSED' }
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

    return { status: 'COMPLETED', result: { signedTypedData } }
  }
}
