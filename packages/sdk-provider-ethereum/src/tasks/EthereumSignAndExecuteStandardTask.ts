import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  type TaskContext,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { Address, Hash, Hex, SendTransactionParameters } from 'viem'
import { estimateGas, sendTransaction } from 'viem/actions'
import { getAction } from 'viem/utils'
import { encodeNativePermitData } from '../permits/encodeNativePermitData.js'
import { encodePermit2Data } from '../permits/encodePermit2Data.js'
import { signPermit2Message } from '../permits/signPermit2Message.js'
import { convertExtendedChain } from '../utils/convertExtendedChain.js'
import { getActionWithFallback } from '../utils/getActionWithFallback.js'
import { getDomainChainId } from '../utils/getDomainChainId.js'
import { getPermit2Supported } from './helpers/allowanceTaskHelpers.js'
import { checkClient as checkClientHelper } from './helpers/checkClient.js'
import { shouldRunSignAndExecute } from './helpers/signAndExecuteTaskHelpers.js'
import type { EthereumTaskExtra } from './types.js'

/** Standard execution: sendTransaction (optionally with native permit or permit2 encoding). */
export class EthereumSignAndExecuteStandardTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  void
> {
  readonly type = 'ETHEREUM_SIGN_AND_EXECUTE_STANDARD'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<boolean> {
    return (
      context.executionStrategy === 'standard' &&
      shouldRunSignAndExecute(context)
    )
  }

  protected override async run(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<void>> {
    context.signedTypedData = context.signedTypedData ?? []
    const signedTypedData = context.signedTypedData
    const {
      client,
      step,
      fromChain,
      action,
      actionType,
      statusManager,
      transactionRequest,
    } = context
    const permit2Supported = getPermit2Supported(context)

    if (!transactionRequest) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Transaction request is not found.'
      )
    }

    const updatedClient = await checkClientHelper(
      step,
      action,
      undefined,
      context.getClient,
      context.setClient,
      context.statusManager,
      context.allowUserInteraction,
      context.switchChain
    )
    if (!updatedClient) {
      return { status: 'PAUSED' }
    }

    let request = { ...transactionRequest }
    const signedNativePermitTypedData = signedTypedData.find(
      (p) =>
        p.primaryType === 'Permit' &&
        getDomainChainId(p.domain) === fromChain.id
    )

    if (signedNativePermitTypedData) {
      request = {
        ...request,
        data: encodeNativePermitData(
          step.action.fromToken.address as Address,
          BigInt(step.action.fromAmount),
          signedNativePermitTypedData.message.deadline,
          signedNativePermitTypedData.signature,
          request.data as Hex
        ),
      }
    } else if (permit2Supported) {
      context.action = statusManager.updateAction(
        step,
        actionType,
        'MESSAGE_REQUIRED'
      )
      const permit2Signature = await signPermit2Message(client, {
        client: updatedClient,
        chain: fromChain,
        tokenAddress: step.action.fromToken.address as Address,
        amount: BigInt(step.action.fromAmount),
        data: request.data as Hex,
      })
      request = {
        ...request,
        data: encodePermit2Data(
          step.action.fromToken.address as Address,
          BigInt(step.action.fromAmount),
          permit2Signature.message.nonce,
          permit2Signature.message.deadline,
          request.data as Hex,
          permit2Signature.signature
        ),
      }
      context.action = statusManager.updateAction(
        step,
        actionType,
        'ACTION_REQUIRED'
      )
    }

    if (signedNativePermitTypedData || permit2Supported) {
      request.to = fromChain.permit2Proxy as Address
      try {
        const estimatedGas = await getActionWithFallback(
          client,
          updatedClient,
          estimateGas,
          'estimateGas',
          {
            account: updatedClient.account!,
            to: request.to as Address,
            data: request.data as Hex,
            value: request.value,
          }
        )
        request.gas =
          request.gas && request.gas > estimatedGas ? request.gas : estimatedGas
      } catch (_) {
        if (request.gas) {
          request.gas = request.gas + 80_000n
        }
      }
    }

    const txHash = (await getAction(
      updatedClient,
      sendTransaction,
      'sendTransaction'
    )({
      to: request.to as Address,
      account: updatedClient.account!,
      data: request.data as Hex,
      value: request.value,
      gas: request.gas,
      gasPrice: request.gasPrice,
      maxFeePerGas: request.maxFeePerGas,
      maxPriorityFeePerGas: request.maxPriorityFeePerGas,
      chain: convertExtendedChain(fromChain),
    } as SendTransactionParameters)) as Hash

    context.action = statusManager.updateAction(step, actionType, 'PENDING', {
      txHash,
      txType: 'standard',
      txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${txHash}`,
    })
    return { status: 'COMPLETED' }
  }
}
