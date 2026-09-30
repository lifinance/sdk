import {
  BaseStepExecutionTask,
  ExecuteStepRetryError,
  LiFiErrorCode,
  stepComparison,
  type TaskResult,
  TransactionError,
  type TransactionParameters,
} from '@lifi/sdk'
import { getMaxPriorityFeePerGas } from '../../actions/getMaxPriorityFeePerGas.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import {
  getEthereumExecutionStrategy,
  STRATEGY_AFTER_PREPARE,
} from './helpers/getEthereumExecutionStrategy.js'
import { getUpdatedStep } from './helpers/getUpdatedStep.js'
import { isAllowancePreparedForAnotherStrategy } from './helpers/isAllowancePreparedForAnotherStrategy.js'
import { preservePermit2Allowances } from './helpers/preservePermit2Allowances.js'

export class EthereumPrepareTransactionTask extends BaseStepExecutionTask {
  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
    const {
      step,
      client,
      executionOptions,
      statusManager,
      allowUserInteraction,
      checkClient,
      isBridgeExecution,
      signedTypedData,
      ethereumClient,
      fromChain,
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

    // Try to prepare a new transaction request and update the step with typed data
    const updatedStep = await getUpdatedStep(
      client,
      step,
      fromChain,
      executionOptions,
      signedTypedData
    )

    const comparedStep = await stepComparison(
      statusManager,
      step,
      updatedStep,
      allowUserInteraction,
      executionOptions
    )

    const answeredTypedData = updatedStep.typedData ?? step.typedData

    Object.assign(step, {
      ...comparedStep,
      execution: step.execution,
      typedData: preservePermit2Allowances(
        step,
        updatedStep.typedData,
        fromChain
      ),
    })

    if (!step.transactionRequest && !answeredTypedData?.length) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Transaction request is not found.'
      )
    }

    // Recompute execution strategy after PrepareTransaction mutates step
    const executionStrategy = await getEthereumExecutionStrategy(context, true)

    // The allowance tasks ran before prepare, in the strategy the step seemed to
    // have then. In `batched` they only queue their work, so if the re-quote
    // shows another strategy and that work does not hold in it — calls queued
    // for a batch that will never be sent, or an allowance checked against
    // another spender — the step replays in the strategy prepare has just
    // established, and the allowance tasks run again for it. Flushing the calls
    // is no fix: they were built for the other spender. Nothing of the step has
    // reached the wallet yet, and this runs before the fee lookup and the
    // integrator hook.
    //
    // After `standard` an approval can already be on-chain, so a mismatch there
    // is left as it was: a replay would ask for a second approval, and a signer
    // that fails the Permit2 probe cannot use the relayed lane anyway.
    const allowanceStrategy = context.executionStrategy
    const isReplay = context.retryParams?.[STRATEGY_AFTER_PREPARE] !== undefined
    if (
      allowanceStrategy &&
      (allowanceStrategy === 'batched' || isReplay) &&
      (await isAllowancePreparedForAnotherStrategy(
        context,
        allowanceStrategy,
        executionStrategy
      ))
    ) {
      // `executeRoute` replays a step once. The replay has already run its
      // allowance tasks in the strategy the previous prepare established, so a
      // second change fails the step rather than executing it against the
      // wrong allowance.
      if (context.retryParams) {
        throw new TransactionError(
          LiFiErrorCode.TransactionUnprepared,
          `Unable to prepare transaction. The step resolved to the ${executionStrategy} strategy after its allowance was prepared for ${allowanceStrategy}.`
        )
      }
      throw new ExecuteStepRetryError(
        `The step resolved to the ${executionStrategy} strategy after its allowance was prepared for ${allowanceStrategy}; retry in that strategy`,
        { [STRATEGY_AFTER_PREPARE]: executionStrategy }
      )
    }

    let transactionRequest: TransactionParameters | undefined
    if (step.transactionRequest) {
      // Only fetch maxPriorityFeePerGas for local accounts
      let maxPriorityFeePerGas: bigint | undefined
      if (ethereumClient.account?.type === 'local') {
        const updatedClient = await checkClient(step)
        if (!updatedClient) {
          return { status: 'PAUSED' }
        }
        maxPriorityFeePerGas = await getMaxPriorityFeePerGas(
          client,
          updatedClient
        )
      } else {
        maxPriorityFeePerGas = step.transactionRequest.maxPriorityFeePerGas
          ? BigInt(step.transactionRequest.maxPriorityFeePerGas)
          : undefined
      }
      transactionRequest = {
        chainId: step.transactionRequest.chainId,
        to: step.transactionRequest.to,
        from: step.transactionRequest.from,
        data: step.transactionRequest.data,
        value: step.transactionRequest.value
          ? BigInt(step.transactionRequest.value)
          : undefined,
        gas: step.transactionRequest.gasLimit
          ? BigInt(step.transactionRequest.gasLimit)
          : undefined,
        // gasPrice: step.transactionRequest.gasPrice
        //   ? BigInt(step.transactionRequest.gasPrice as string)
        //   : undefined,
        // maxFeePerGas: step.transactionRequest.maxFeePerGas
        //   ? BigInt(step.transactionRequest.maxFeePerGas as string)
        //   : undefined,
        maxPriorityFeePerGas,
      }
    }

    if (executionOptions?.updateTransactionRequestHook && transactionRequest) {
      const customizedTransactionRequest: TransactionParameters =
        await executionOptions.updateTransactionRequestHook({
          requestType: 'transaction',
          ...transactionRequest,
        })
      transactionRequest = {
        ...transactionRequest,
        ...customizedTransactionRequest,
      }
    }

    return {
      status: 'COMPLETED',
      context: { transactionRequest, executionStrategy },
    }
  }
}
