import type { ExtendedChain, LiFiStep, SignedTypedData } from '@lifi/types'
import type { Address, Client, Hash } from 'viem'
import { signTypedData } from 'viem/actions'
import { getAction } from 'viem/utils'
import { MaxUint256 } from '../../constants.js'
import type { StatusManager } from '../StatusManager.js'
import type {
  ExecutionOptions,
  LiFiStepExtended,
  Process,
  ProcessType,
} from '../types.js'
import { getActionWithFallback } from './getActionWithFallback.js'
import { getAllowance } from './getAllowance.js'
import { parseEVMErrors } from './parseEVMErrors.js'
import { getNativePermit } from './permits/getNativePermit.js'
import { isNativePermitValid } from './permits/isNativePermitValid.js'
import type { NativePermitData } from './permits/types.js'
import { setAllowance } from './setAllowance.js'
import type { Call } from './types.js'
import { waitForTransactionReceipt } from './waitForTransactionReceipt.js'

export type CheckAllowanceParams = {
  client: Client
  chain: ExtendedChain
  step: LiFiStep
  statusManager: StatusManager
  executionOptions?: ExecutionOptions
  allowUserInteraction?: boolean
  batchingSupported?: boolean
  permit2Supported?: boolean
  disableMessageSigning?: boolean
  checkClient(
    step: LiFiStepExtended,
    process: Process,
    targetChainId?: number
  ): Promise<Client | undefined>
}

export type AllowanceResult =
  | {
      status: 'ACTION_REQUIRED'
    }
  | {
      status: 'BATCH_APPROVAL'
      data: { call: Call; signedPermits: Map<number, SignedTypedData> }
    }
  | {
      status: 'NATIVE_PERMIT' | 'DONE'
      data: Map<number, SignedTypedData>
    }

export const checkAllowance = async ({
  client,
  chain,
  step,
  statusManager,
  executionOptions,
  allowUserInteraction = false,
  batchingSupported = false,
  permit2Supported = false,
  disableMessageSigning = false,
  checkClient,
}: CheckAllowanceParams): Promise<AllowanceResult> => {
  // Find existing or create new allowance process
  let sharedProcess: Process = statusManager.findOrCreateProcess({
    step,
    type: 'PERMIT',
    chainId: step.action.fromChainId,
  })
  try {
    // First, sign all permits in step.typedData if allowUserInteraction is enabled
    const signedPermits: Map<number, SignedTypedData> =
      sharedProcess.signedPermits ?? new Map()

    if (allowUserInteraction && !disableMessageSigning && step.typedData) {
      for (const typedData of step.typedData) {
        if (typedData.primaryType === 'Permit') {
          const permitChainId = typedData.domain.chainId as number
          const spenderAddress = typedData.message.spender as Address
          const fromAmount = BigInt(typedData.message.value)

          // Check if we already have a valid permit for this chain and requirements
          const existingValidPermit =
            signedPermits.has(permitChainId) &&
            isNativePermitValid(
              signedPermits.get(permitChainId)!,
              permitChainId,
              spenderAddress,
              client.account!.address,
              fromAmount
            )

          if (existingValidPermit) {
            // Skip signing if we already have a valid permit
            continue
          }

          // Switch to the permit's chain if needed
          const permitClient = await checkClient(
            step,
            sharedProcess,
            permitChainId
          )
          if (!permitClient) {
            return { status: 'ACTION_REQUIRED' }
          }
          sharedProcess = statusManager.updateProcess(
            step,
            sharedProcess.type,
            'ACTION_REQUIRED'
          )
          const signature = await getAction(
            permitClient,
            signTypedData,
            'signTypedData'
          )({
            account: permitClient.account!,
            domain: typedData.domain,
            types: typedData.types,
            primaryType: 'Permit',
            message: typedData.message,
          })
          const signedPermit: SignedTypedData = {
            ...typedData,
            signature,
          }
          signedPermits.set(permitChainId, signedPermit)
          sharedProcess = statusManager.updateProcess(
            step,
            sharedProcess.type,
            'ACTION_REQUIRED',
            {
              signedPermits,
            }
          )
        }
      }

      statusManager.updateProcess(step, sharedProcess.type, 'DONE', {
        signedPermits,
      })
      // Check if there's a signed permit for the source transaction chain
      const matchingPermit = signedPermits.get(chain.id)
      if (matchingPermit) {
        return {
          status: 'NATIVE_PERMIT',
          data: signedPermits,
        }
      }
    }

    statusManager.updateProcess(step, sharedProcess.type, 'DONE', {
      signedPermits,
    })

    // Find existing or create new allowance process
    sharedProcess = statusManager.findOrCreateProcess({
      step,
      type: 'TOKEN_ALLOWANCE',
      chainId: step.action.fromChainId,
    })

    const updatedClient = await checkClient(step, sharedProcess)
    if (!updatedClient) {
      return { status: 'ACTION_REQUIRED' }
    }

    // Handle existing pending transaction
    if (sharedProcess.txHash && sharedProcess.status !== 'DONE') {
      await waitForApprovalTransaction(
        updatedClient,
        sharedProcess.txHash as Address,
        sharedProcess.type,
        step,
        chain,
        statusManager
      )
      return { status: 'DONE', data: signedPermits }
    }

    // Start new allowance check
    statusManager.updateProcess(step, sharedProcess.type, 'STARTED')

    const spenderAddress = permit2Supported
      ? chain.permit2
      : step.estimate.approvalAddress

    const fromAmount = BigInt(step.action.fromAmount)

    const approved = await getAllowance(
      updatedClient,
      step.action.fromToken.address as Address,
      updatedClient.account!.address,
      spenderAddress as Address
    )

    // Return early if already approved
    if (fromAmount <= approved) {
      statusManager.updateProcess(step, sharedProcess.type, 'DONE')
      return { status: 'DONE', data: signedPermits }
    }

    // Check if proxy contract is available and message signing is not disabled, also not available for atomic batch
    const isNativePermitAvailable =
      !!chain.permit2Proxy && !batchingSupported && !disableMessageSigning

    let nativePermitData: NativePermitData | undefined
    if (isNativePermitAvailable) {
      nativePermitData = await getActionWithFallback(
        updatedClient,
        getNativePermit,
        'getNativePermit',
        {
          chainId: chain.id,
          tokenAddress: step.action.fromToken.address as Address,
          spenderAddress: chain.permit2Proxy as Address,
          amount: fromAmount,
        }
      )
    }

    statusManager.updateProcess(step, sharedProcess.type, 'ACTION_REQUIRED')

    if (!allowUserInteraction) {
      return { status: 'ACTION_REQUIRED' }
    }

    if (isNativePermitAvailable && nativePermitData) {
      // Check if we already have a valid permit for this chain and requirements
      const existingValidPermit =
        signedPermits.has(nativePermitData.domain.chainId as number) &&
        isNativePermitValid(
          signedPermits.get(nativePermitData.domain.chainId as number)!,
          nativePermitData.domain.chainId as number,
          nativePermitData.message.spender as Address,
          client.account!.address,
          BigInt(nativePermitData.message.value)
        )

      if (!existingValidPermit) {
        // Sign the permit
        const signature = await getAction(
          updatedClient,
          signTypedData,
          'signTypedData'
        )({
          account: updatedClient.account!,
          domain: nativePermitData.domain,
          types: nativePermitData.types,
          primaryType: 'Permit',
          message: nativePermitData.message,
        })

        // Add the new permit to the signed permits array
        const signedPermit: SignedTypedData = {
          ...nativePermitData,
          signature,
        }
        signedPermits.set(
          nativePermitData.domain.chainId as number,
          signedPermit
        )
      }

      statusManager.updateProcess(step, sharedProcess.type, 'DONE', {
        signedPermits,
      })
      return {
        status: 'NATIVE_PERMIT',
        data: signedPermits,
      }
    }

    // Set new allowance
    const approveAmount = permit2Supported ? MaxUint256 : fromAmount
    const approveTxHash = await setAllowance(
      updatedClient,
      step.action.fromToken.address as Address,
      spenderAddress as Address,
      approveAmount,
      executionOptions,
      batchingSupported
    )

    if (batchingSupported) {
      statusManager.updateProcess(step, sharedProcess.type, 'DONE')
      return {
        status: 'BATCH_APPROVAL',
        data: {
          call: {
            to: step.action.fromToken.address as Address,
            data: approveTxHash,
            chainId: step.action.fromToken.chainId,
          },
          signedPermits,
        },
      }
    }

    await waitForApprovalTransaction(
      updatedClient,
      approveTxHash,
      sharedProcess.type,
      step,
      chain,
      statusManager
    )

    return { status: 'DONE', data: signedPermits }
  } catch (e: any) {
    const error = await parseEVMErrors(e, step, sharedProcess)
    statusManager.updateProcess(step, sharedProcess.type, 'FAILED', {
      error: {
        message: error.cause.message,
        code: error.code,
      },
    })
    statusManager.updateExecution(step, 'FAILED')
    throw error
  }
}

const waitForApprovalTransaction = async (
  client: Client,
  txHash: Hash,
  processType: ProcessType,
  step: LiFiStep,
  chain: ExtendedChain,
  statusManager: StatusManager
) => {
  const baseExplorerUrl = chain.metamask.blockExplorerUrls[0]
  const getTxLink = (hash: Hash) => `${baseExplorerUrl}tx/${hash}`

  statusManager.updateProcess(step, processType, 'PENDING', {
    txHash,
    txLink: getTxLink(txHash),
  })

  const transactionReceipt = await waitForTransactionReceipt({
    client,
    chainId: chain.id,
    txHash,
    onReplaced(response) {
      const newHash = response.transaction.hash
      statusManager.updateProcess(step, processType, 'PENDING', {
        txHash: newHash,
        txLink: getTxLink(newHash),
      })
    },
  })

  const finalHash = transactionReceipt?.transactionHash || txHash
  statusManager.updateProcess(step, processType, 'DONE', {
    txHash: finalHash,
    txLink: getTxLink(finalHash),
  })
}
