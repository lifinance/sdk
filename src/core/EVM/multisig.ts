import type { ExtendedChain, LiFiStep, ProcessType } from '@lifi/types'
import type { Hash } from 'viem'
import { LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError } from '../../errors/errors.js'
import type { StatusManager } from '../StatusManager.js'
import type { MultisigConfig, MultisigTxDetails } from './types.js'

export const updateMultisigRouteProcess = async (
  internalTxHash: Hash,
  step: LiFiStep,
  processType: ProcessType,
  fromChain: ExtendedChain,
  statusManager: StatusManager,
  multisig?: MultisigConfig
) => {
  if (!multisig?.getMultisigTransactionDetails) {
    throw new Error(
      'getMultisigTransactionDetails is missing in multisig config.'
    )
  }

  const updateIntermediateMultisigStatus = () => {
    statusManager.updateProcess(step, processType, 'PENDING')
  }

  const multisigStatusResponse: MultisigTxDetails =
    await multisig?.getMultisigTransactionDetails(
      internalTxHash,
      fromChain.id,
      updateIntermediateMultisigStatus
    )

  if (multisigStatusResponse.status === 'DONE') {
    statusManager.updateProcess(step, processType, 'PENDING', {
      txHash: multisigStatusResponse.txHash,
      multisigTxHash: undefined,
      txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${multisigStatusResponse.txHash}`,
    })
  }

  if (multisigStatusResponse.status === 'FAILED') {
    throw new TransactionError(
      LiFiErrorCode.TransactionFailed,
      'Multisig transaction failed.'
    )
  }

  if (multisigStatusResponse.status === 'CANCELLED') {
    throw new TransactionError(
      LiFiErrorCode.SignatureRejected,
      'Transaction was rejected by user.'
    )
  }
}
