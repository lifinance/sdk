import {
  BaseStepExecutionTask,
  ExecuteStepRetryError,
  isGaslessStep,
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
      disableMessageSigning,
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

    // The relayer executes a gasless step from the user's signature, and the
    // user has no gas to send it themselves. Fail before the re-quote.
    if (isGaslessStep(step) && disableMessageSigning) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. A gasless step needs message signing, which is disabled.'
      )
    }

    // A replay restores it, so the replay re-quotes like this attempt did.
    const typedDataBeforePrepare = step.typedData

    // Try to prepare a new transaction request and update the step with typed data
    const updatedStep = await getUpdatedStep(
      client,
      step,
      fromChain,
      executionOptions,
      signedTypedData
    )

    // An EIP-7702 authorization installs a delegation on an account that has
    // none. The relayer rejects it for now, so signing it would be wasted.
    if ((updatedStep as { authorization?: unknown }).authorization) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. The gasless step needs an EIP-7702 authorization, which the relayer does not support yet.'
      )
    }

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

    // The allowance tasks ran before prepare, in the strategy the step seemed
    // to have. In `batched` they only queued their work. If the re-quote moves
    // the step to a strategy that work does not fit, replay the step in the new
    // strategy (JUMEMB-102): only the batched task sends queued calls, and the
    // new strategy can need another spender. Sending the queued calls instead
    // could approve that wrong spender.
    //
    // A first run in `standard` is not replayed: its approval can already be
    // on-chain, and a signer that fails the Permit2 probe cannot use the relayed
    // lane anyway. A replay is checked again, whatever its strategy.
    const allowanceStrategy = context.executionStrategy
    const isReplay = context.retryParams !== undefined
    if (
      allowanceStrategy &&
      (allowanceStrategy === 'batched' || isReplay) &&
      (await isAllowancePreparedForAnotherStrategy(
        context,
        allowanceStrategy,
        executionStrategy
      ))
    ) {
      // `executeRoute` replays a step only once, so a second change fails it.
      if (isReplay) {
        throw new TransactionError(
          LiFiErrorCode.TransactionUnprepared,
          `Unable to prepare transaction. The step resolved to the ${executionStrategy} strategy after its allowance was prepared for ${allowanceStrategy}.`
        )
      }
      step.typedData = typedDataBeforePrepare
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
