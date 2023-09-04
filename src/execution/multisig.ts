import type { ExtendedChain, LiFiStep, ProcessType } from '@lifi/types'
import type { Hash } from 'viem'
import ConfigService from '../services/ConfigService'
import { LiFiErrorCode, TransactionError } from '../utils/errors'
import type { StatusManager } from './StatusManager'
import type { MultisigTxDetails } from './types'

export const updateMultisigRouteProcess = async (
  internalTxHash: Hash,
  step: LiFiStep,
  statusManager: StatusManager,
  processType: ProcessType,
  fromChain: ExtendedChain
) => {
  const config = ConfigService.getInstance().getConfig()

  if (!config.multisig?.getMultisigTransactionDetails) {
    throw new Error(
      'getMultisigTransactionDetails is missing in multisig config.'
    )
  }

  const updateIntermediateMultisigStatus = () => {
    statusManager.updateProcess(step, processType, 'PENDING')
  }

  const multisigStatusResponse: MultisigTxDetails =
    await config.multisig?.getMultisigTransactionDetails(
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
