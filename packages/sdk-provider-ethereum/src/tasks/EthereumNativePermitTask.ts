import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type SignedTypedData,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import type { Address, Client } from 'viem'
import { signTypedData } from 'viem/actions'
import { getAction } from 'viem/utils'
import { getNativePermit } from '../permits/getNativePermit.js'
import { isNativePermitValid } from '../permits/isNativePermitValid.js'
import { getActionWithFallback } from '../utils/getActionWithFallback.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumNativePermitTask extends BaseStepExecutionTask<EthereumTaskExtra> {
  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>,
    action?: ExecutionAction,
    payload?: {
      signedTypedData: SignedTypedData[]
      updatedClient: Client
      batchingSupported: boolean
      approved: bigint
      spenderAddress: Address
    }
  ): Promise<boolean> {
    const { step, fromChain, disableMessageSigning } = context
    // Check if proxy contract is available and message signing is not disabled, also not available for atomic batch
    const isNativePermitAvailable =
      !!fromChain.permit2Proxy &&
      !payload?.batchingSupported &&
      !disableMessageSigning &&
      !step.estimate.skipPermit
    return !context.isTransactionExecuted(action) && isNativePermitAvailable
  }

  async run(
    context: TaskContext<EthereumTaskExtra>,
    action: ExecutionAction,
    payload: {
      signedTypedData: SignedTypedData[]
      updatedClient: Client
      batchingSupported: boolean
      approved: bigint
      spenderAddress: Address
    }
  ): Promise<TaskResult> {
    const { step, client, fromChain, statusManager, allowUserInteraction } =
      context

    let {
      signedTypedData,
      updatedClient,
      batchingSupported,
      approved,
      spenderAddress,
    } = payload

    const fromAmount = BigInt(step.action.fromAmount)

    const nativePermitData = await getActionWithFallback(
      client,
      updatedClient,
      getNativePermit,
      'getNativePermit',
      {
        client,
        viemClient: updatedClient,
        chainId: fromChain.id,
        tokenAddress: step.action.fromToken.address as Address,
        spenderAddress: fromChain.permit2Proxy as Address,
        amount: fromAmount,
      }
    )

    if (!nativePermitData) {
      return {
        status: 'COMPLETED',
        data: {
          signedTypedData,
          updatedClient,
          batchingSupported,
          approved,
          spenderAddress,
        },
      }
    }

    signedTypedData = signedTypedData.length
      ? signedTypedData
      : action.signedTypedData || []

    // Check if we already have a valid permit for this chain and requirements
    const signedTypedDataForChain = signedTypedData.find((signedTypedData) =>
      isNativePermitValid(signedTypedData, nativePermitData)
    )

    if (!signedTypedDataForChain) {
      statusManager.updateAction(step, action.type, 'ACTION_REQUIRED')

      if (!allowUserInteraction) {
        return { status: 'PAUSED' }
      }

      // Sign the permit
      const signature = await getAction(
        updatedClient,
        signTypedData,
        'signTypedData'
      )({
        account: updatedClient.account!,
        domain: nativePermitData.domain,
        types: nativePermitData.types,
        primaryType: nativePermitData.primaryType,
        message: nativePermitData.message,
      })

      // Add the new permit to the signed permits array
      const signedPermit: SignedTypedData = {
        ...nativePermitData,
        signature,
      }
      signedTypedData.push(signedPermit)
    }

    statusManager.updateAction(step, action.type, 'DONE', {
      signedTypedData,
    })

    return {
      status: 'COMPLETED',
      data: {
        signedTypedData,
      },
    }
  }
}
