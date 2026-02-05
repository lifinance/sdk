import {
  BaseStepExecutionTask,
  type ExecutionAction,
  getRelayerQuote,
  LiFiErrorCode,
  type LiFiStep,
  stepComparison,
  type TaskContext,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import { isGaslessStep } from '../../utils/isGaslessStep.js'
import { isRelayerStep } from '../../utils/isRelayerStep.js'
import type {
  EthereumPrepareTransactionResult,
  EthereumTaskExtra,
} from '../types.js'

/** Relayer execution: getRelayerQuote to obtain typed data for relay. */
export class EthereumRelayerPrepareTransactionTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  EthereumPrepareTransactionResult
> {
  readonly type = 'ETHEREUM_RELAYER_PREPARE_TRANSACTION'
  readonly actionType = 'EXCHANGE'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>,
    action?: ExecutionAction
  ): Promise<boolean> {
    if (context.executionStrategy !== 'relayer') {
      return false
    }
    return !context.isTransactionExecuted(action)
  }

  protected async run(
    context: TaskContext<EthereumTaskExtra>,
    action: ExecutionAction
  ): Promise<TaskResult<EthereumPrepareTransactionResult>> {
    const { client, step, allowUserInteraction, statusManager } = context

    const { execution, ...stepBase } = step
    if (!isRelayerStep(step) || !isGaslessStep(step)) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Relayer prepare requires a relayer gasless step.'
      )
    }

    const updatedRelayedStep = await getRelayerQuote(client, {
      fromChain: stepBase.action.fromChainId,
      fromToken: stepBase.action.fromToken.address,
      fromAddress: stepBase.action.fromAddress!,
      fromAmount: stepBase.action.fromAmount,
      toChain: stepBase.action.toChainId,
      toToken: stepBase.action.toToken.address,
      slippage: stepBase.action.slippage,
      toAddress: stepBase.action.toAddress,
      allowBridges: [stepBase.tool],
    })
    const updatedStep: LiFiStep = { ...updatedRelayedStep, id: stepBase.id }

    const comparedStep = await stepComparison(
      statusManager,
      step,
      updatedStep,
      allowUserInteraction,
      context.executionOptions
    )
    Object.assign(step, {
      ...comparedStep,
      execution: step.execution,
      typedData: updatedStep.typedData ?? step.typedData,
    })

    if (!step.transactionRequest && !step.typedData?.length) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction.'
      )
    }

    statusManager.updateAction(step, action.type, 'ACTION_REQUIRED')

    if (!allowUserInteraction) {
      return { status: 'PAUSED' }
    }

    return {
      status: 'COMPLETED',
      data: {
        transactionRequest: undefined,
        isRelayerTransaction: true,
      },
    }
  }
}
