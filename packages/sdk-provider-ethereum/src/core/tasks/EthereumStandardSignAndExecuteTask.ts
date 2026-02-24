import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { Address, Hex, SendTransactionParameters } from 'viem'
import { sendTransaction } from 'viem/actions'
import { getAction } from 'viem/utils'
import { encodeNativePermitData } from '../../permits/encodeNativePermitData.js'
import { encodePermit2Data } from '../../permits/encodePermit2Data.js'
import { signPermit2Message } from '../../permits/signPermit2Message.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { convertExtendedChain } from '../../utils/convertExtendedChain.js'
import { getDomainChainId } from '../../utils/getDomainChainId.js'
import { estimateTransactionRequest } from './helpers/estimateTransactionRequest.js'
import { isPermit2Supported } from './helpers/isPermit2Supported.js'

export class EthereumStandardSignAndExecuteTask extends BaseStepExecutionTask {
  static override readonly name = 'ETHEREUM_STANDARD_SIGN_AND_EXECUTE' as const
  override readonly taskName = EthereumStandardSignAndExecuteTask.name

  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
    const {
      step,
      client,
      fromChain,
      statusManager,
      isFromNativeToken,
      disableMessageSigning,
      checkClient,
      tasksResults,
      allowUserInteraction,
      isBridgeExecution,
    } = context

    const transactionRequest = tasksResults.transactionRequest

    if (!transactionRequest) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Transaction request is not found.'
      )
    }

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

    // Make sure that the chain is still correct
    const updatedClient = await checkClient(step)
    if (!updatedClient) {
      return { status: 'PAUSED' }
    }

    const permit2Supported = isPermit2Supported(
      step,
      fromChain,
      isFromNativeToken,
      disableMessageSigning,
      'standard'
    )
    const signedNativePermitTypedData = tasksResults.signedTypedData.find(
      (p) =>
        p.primaryType === 'Permit' &&
        getDomainChainId(p.domain) === fromChain.id
    )
    if (signedNativePermitTypedData) {
      transactionRequest.data = encodeNativePermitData(
        step.action.fromToken.address as Address,
        BigInt(step.action.fromAmount),
        signedNativePermitTypedData.message.deadline,
        signedNativePermitTypedData.signature,
        transactionRequest.data as Hex
      )
    } else if (permit2Supported) {
      statusManager.updateAction(step, action.type, 'MESSAGE_REQUIRED')
      if (!allowUserInteraction) {
        return { status: 'PAUSED' }
      }
      const permit2Signature = await signPermit2Message(client, {
        client: updatedClient,
        chain: fromChain,
        tokenAddress: step.action.fromToken.address as Address,
        amount: BigInt(step.action.fromAmount),
        data: transactionRequest.data as Hex,
      })
      transactionRequest.data = encodePermit2Data(
        step.action.fromToken.address as Address,
        BigInt(step.action.fromAmount),
        permit2Signature.message.nonce,
        permit2Signature.message.deadline,
        transactionRequest.data as Hex,
        permit2Signature.signature
      )
      statusManager.updateAction(step, action.type, 'ACTION_REQUIRED')
      if (!allowUserInteraction) {
        return { status: 'PAUSED' }
      }
    }

    let finalTransactionRequest = transactionRequest
    if (signedNativePermitTypedData || permit2Supported) {
      // Target address should be the Permit2 proxy contract in case of native permit or Permit2
      finalTransactionRequest = {
        ...transactionRequest,
        to: fromChain.permit2Proxy as Address,
      }
      finalTransactionRequest = await estimateTransactionRequest(
        client,
        updatedClient,
        finalTransactionRequest
      )
    }

    const txHash = await getAction(
      updatedClient,
      sendTransaction,
      'sendTransaction'
    )({
      to: finalTransactionRequest.to as Address,
      account: updatedClient.account!,
      data: finalTransactionRequest.data as Hex,
      value: finalTransactionRequest.value,
      gas: finalTransactionRequest.gas,
      gasPrice: finalTransactionRequest.gasPrice,
      maxFeePerGas: finalTransactionRequest.maxFeePerGas,
      maxPriorityFeePerGas: finalTransactionRequest.maxPriorityFeePerGas,
      chain: convertExtendedChain(fromChain),
    } as SendTransactionParameters)

    statusManager.updateAction(step, action.type, 'PENDING', {
      txHash,
      txType: 'standard',
      txLink: txHash
        ? `${fromChain.metamask.blockExplorerUrls[0]}tx/${txHash}`
        : undefined,
      signedAt: Date.now(),
    })

    return {
      status: 'COMPLETED',
      result: { transactionRequest: finalTransactionRequest },
    }
  }
}
