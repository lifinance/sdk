import type { ExtendedChain, LifiStep, ProcessType } from '@lifi/types'
import type { Hash } from 'viem'
import type { StatusManager } from '.'
import type { MultisigTxDetails } from '..'
import ConfigService from '../services/ConfigService'
import { LifiErrorCode, TransactionError } from '../utils/errors'

export const updateMultisigRouteProcess = async (
  internalTxHash: Hash,
  step: LifiStep,
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
      LifiErrorCode.TransactionFailed,
      'Multisig transaction failed.'
    )
  }

  if (multisigStatusResponse.status === 'CANCELLED') {
    throw new TransactionError(
      LifiErrorCode.TransactionRejected,
      'Transaction was rejected by user.'
    )
  }
}
