import type { TaskContext, TaskResult } from '@lifi/sdk'
import {
  LiFiErrorCode,
  relayTransaction,
  TransactionError,
  type TransactionMethodType,
} from '@lifi/sdk'
import type { Address, Hash, Hex, SendTransactionParameters } from 'viem'
import { sendCalls, sendTransaction, signTypedData } from 'viem/actions'
import { getAction } from 'viem/utils'
import { encodeNativePermitData } from '../permits/encodeNativePermitData.js'
import { encodePermit2Data } from '../permits/encodePermit2Data.js'
import { isNativePermitValid } from '../permits/isNativePermitValid.js'
import { signPermit2Message } from '../permits/signPermit2Message.js'
import { convertExtendedChain } from '../utils/convertExtendedChain.js'
import { getDomainChainId } from '../utils/getDomainChainId.js'
import { EthereumStepExecutionTask } from './EthereumStepExecutionTask.js'
import { estimateTransactionRequest as estimateTransactionRequestHelper } from './helpers/estimateTransactionRequest.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumSignAndExecuteTask extends EthereumStepExecutionTask<void> {
  readonly type = 'ETHEREUM_SIGN_AND_EXECUTE'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<boolean> {
    const { action } = context
    return !action.txHash && !action.taskId && action.status !== 'DONE'
  }

  protected async run(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<void>> {
    const {
      client,
      step,
      fromChain,
      action,
      actionType,
      statusManager,
      checkClient,
      calls,
      signedTypedData,
      batchingSupported,
      permit2Supported,
      transactionRequest,
      isRelayerTransaction,
    } = context

    let txHash: Hash | undefined
    let taskId: Hash | undefined
    let txType: TransactionMethodType = 'standard'
    let txLink: string | undefined

    if (batchingSupported && transactionRequest) {
      const updatedClient = await checkClient(step, action)
      if (!updatedClient) {
        return { status: 'PAUSED' }
      }
      const transferCall = {
        chainId: fromChain.id,
        data: transactionRequest.data as Hex,
        to: transactionRequest.to as Address,
        value: transactionRequest.value,
      }
      calls.push(transferCall)

      const { id } = await getAction(
        updatedClient,
        sendCalls,
        'sendCalls'
      )({
        account: updatedClient.account!,
        calls,
      })
      taskId = id as Hash
      txType = 'batched'
    } else if (isRelayerTransaction) {
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
      context.action = statusManager.updateAction(
        step,
        actionType,
        'MESSAGE_REQUIRED'
      )
      for (const typedData of intentTypedData) {
        const typedDataChainId =
          getDomainChainId(typedData.domain) || fromChain.id
        const updatedClient = await checkClient(step, action, typedDataChainId)
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
      context.action = statusManager.updateAction(step, actionType, 'PENDING')
      const { execution, ...stepBase } = step
      const relayedTransaction = await relayTransaction(client, {
        ...stepBase,
        typedData: signedTypedData,
      })
      taskId = relayedTransaction.taskId as Hash
      txType = 'relayed'
      txLink = relayedTransaction.txLink
    } else {
      if (!transactionRequest) {
        throw new TransactionError(
          LiFiErrorCode.TransactionUnprepared,
          'Unable to prepare transaction. Transaction request is not found.'
        )
      }
      const updatedClient = await checkClient(step, action)
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
        request = await estimateTransactionRequestHelper(
          client,
          updatedClient,
          request
        )
      }
      txHash = await getAction(
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
      } as SendTransactionParameters)
    }

    context.action = statusManager.updateAction(step, actionType, 'PENDING', {
      txHash,
      taskId,
      txType,
      txLink:
        txType === 'standard' && txHash
          ? `${fromChain.metamask.blockExplorerUrls[0]}tx/${txHash}`
          : txLink,
    })

    return { status: 'COMPLETED' }
  }
}
