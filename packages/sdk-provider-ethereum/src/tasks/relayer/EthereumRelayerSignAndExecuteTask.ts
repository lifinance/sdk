import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  relayTransaction,
  type TaskContext,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { Hash } from 'viem'
import { signTypedData } from 'viem/actions'
import { getAction } from 'viem/utils'
import { isNativePermitValid } from '../../permits/isNativePermitValid.js'
import { getDomainChainId } from '../../utils/getDomainChainId.js'
import { checkClient as checkClientHelper } from '../helpers/checkClient.js'
import { shouldRunSignAndExecute } from '../helpers/signAndExecuteTaskHelpers.js'
import type { EthereumTaskExtra } from '../types.js'

/** Relayer execution: sign typed data for transfer, then relayTransaction. */
export class EthereumRelayerSignAndExecuteTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  void
> {
  readonly type = 'ETHEREUM_RELAYER_SIGN_AND_EXECUTE'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<boolean> {
    return (
      context.executionStrategy === 'relayer' &&
      shouldRunSignAndExecute(context)
    )
  }

  protected override async run(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<void>> {
    context.signedTypedData = context.signedTypedData ?? []
    const signedTypedData = context.signedTypedData
    const actionType = context.isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    const action = context.getOrCreateAction(actionType)
    if (!action) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Action not found for current step.'
      )
    }
    const { client, step, fromChain, statusManager } = context

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

    statusManager.updateAction(step, actionType, 'MESSAGE_REQUIRED')

    for (const typedData of intentTypedData) {
      const typedDataChainId =
        getDomainChainId(typedData.domain) || fromChain.id
      const updatedClient = await checkClientHelper(
        step,
        action,
        typedDataChainId,
        context.getClient,
        context.setClient,
        context.statusManager,
        context.allowUserInteraction,
        context.switchChain
      )
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
        signature,
      })
    }

    statusManager.updateAction(step, actionType, 'PENDING')

    const { execution, ...stepBase } = step
    const relayedTransaction = await relayTransaction(client, {
      ...stepBase,
      typedData: signedTypedData,
    })

    statusManager.updateAction(step, actionType, 'PENDING', {
      taskId: relayedTransaction.taskId as Hash,
      txType: 'relayed',
      txLink: relayedTransaction.txLink,
    })
    return { status: 'COMPLETED' }
  }
}
