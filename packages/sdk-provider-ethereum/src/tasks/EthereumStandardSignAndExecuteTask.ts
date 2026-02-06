import {
  BaseStepExecutionTask,
  type ExecutionAction,
  LiFiErrorCode,
  type SignedTypedData,
  type TaskContext,
  type TaskResult,
  TransactionError,
  type TransactionParameters,
} from '@lifi/sdk'
import type { Address, Hex, SendTransactionParameters } from 'viem'
import { sendTransaction } from 'viem/actions'
import { getAction } from 'viem/utils'
import { encodeNativePermitData } from '../permits/encodeNativePermitData.js'
import { encodePermit2Data } from '../permits/encodePermit2Data.js'
import { signPermit2Message } from '../permits/signPermit2Message.js'
import { convertExtendedChain } from '../utils/convertExtendedChain.js'
import { getDomainChainId } from '../utils/getDomainChainId.js'
import { isZeroAddress } from '../utils/isZeroAddress.js'
import { estimateTransactionRequest } from './helpers/estimateTransactionRequest.js'
import type { EthereumTaskExtra } from './types.js'

/**
 * Ensures the wallet is on the correct chain when the step is waiting for a destination-chain transaction.
 */
export class EthereumStandardSignAndExecuteTask extends BaseStepExecutionTask<EthereumTaskExtra> {
  readonly type = 'ETHEREUM_STANDARD_SIGN_AND_EXECUTE'
  readonly actionType = 'EXCHANGE'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>,
    action?: ExecutionAction
  ): Promise<boolean> {
    return !context.isTransactionExecuted(action)
  }

  protected async run(
    context: TaskContext<EthereumTaskExtra>,
    action: ExecutionAction,
    payload: {
      transactionRequest: TransactionParameters
      signedTypedData: SignedTypedData[]
    }
  ): Promise<TaskResult> {
    const { step, client, fromChain, executionOptions, statusManager } = context

    let { transactionRequest, signedTypedData } = payload
    if (!transactionRequest) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Transaction request is not found.'
      )
    }

    // Make sure that the chain is still correct
    const updatedClient = await context.checkClient(step, action)
    if (!updatedClient) {
      return { status: 'PAUSED' }
    }

    const isFromNativeToken =
      fromChain.nativeToken.address === step.action.fromToken.address &&
      isZeroAddress(step.action.fromToken.address)

    // Check if message signing is disabled - useful for smart contract wallets
    // We also disable message signing for custom steps
    const disableMessageSigning =
      executionOptions?.disableMessageSigning || step.type !== 'lifi'

    // Check if chain has Permit2 contract deployed. Permit2 should not be available for atomic batch.
    const permit2Supported =
      !!fromChain.permit2 &&
      !!fromChain.permit2Proxy &&
      !isFromNativeToken &&
      !disableMessageSigning &&
      // Approval address is not required for Permit2 per se, but we use it to skip allowance checks for direct transfers
      !!step.estimate.approvalAddress &&
      !step.estimate.skipApproval &&
      !step.estimate.skipPermit

    const signedNativePermitTypedData = signedTypedData.find(
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
    }

    if (signedNativePermitTypedData || permit2Supported) {
      // Target address should be the Permit2 proxy contract in case of native permit or Permit2
      transactionRequest.to = fromChain.permit2Proxy as Address
      transactionRequest = await estimateTransactionRequest(
        client,
        updatedClient,
        transactionRequest
      )
    }

    const txHash = await getAction(
      updatedClient,
      sendTransaction,
      'sendTransaction'
    )({
      to: transactionRequest.to as Address,
      account: updatedClient.account!,
      data: transactionRequest.data as Hex,
      value: transactionRequest.value,
      gas: transactionRequest.gas,
      gasPrice: transactionRequest.gasPrice,
      maxFeePerGas: transactionRequest.maxFeePerGas,
      maxPriorityFeePerGas: transactionRequest.maxPriorityFeePerGas,
      chain: convertExtendedChain(fromChain),
    } as SendTransactionParameters)

    statusManager.updateAction(context.step, action.type, 'PENDING', {
      txHash,
      txType: 'standard',
      txLink: txHash
        ? `${fromChain.metamask.blockExplorerUrls[0]}tx/${txHash}`
        : undefined,
      signedAt: Date.now(),
    })

    return { status: 'COMPLETED' }
  }
}
