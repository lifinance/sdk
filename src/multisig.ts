import { LifiStep, Process, ExtendedChain } from '@lifi/types'
import { MultisigTxDetails } from '.'
import { StatusManager } from './execution'
import ConfigService from './services/ConfigService'
import { TransactionError, LifiErrorCode } from './utils/errors'

export const updateMultisigRouteProcess = async (
  internalTxHash: string,
  step: LifiStep,
  statusManager: StatusManager,
  process: Process,
  fromChain: ExtendedChain
) => {
  const config = ConfigService.getInstance().getConfig()

  if (!config.multisigConfig?.getMultisigTransactionDetails) {
    throw new Error(
      '"getMultisigTransactionDetails()" is missing in Multisig config.'
    )
  }

  const multisigStatusResponse: MultisigTxDetails =
    await config.multisigConfig?.getMultisigTransactionDetails(
      internalTxHash,
      fromChain.id
    )

  if (multisigStatusResponse.status === 'DONE') {
    process = statusManager.updateProcess(step, process.type, 'PENDING', {
      txHash: multisigStatusResponse.txHash,
      multisigTxHash: undefined,
      txLink:
        fromChain.metamask.blockExplorerUrls[0] +
        'tx/' +
        multisigStatusResponse.txHash,
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
      'Transaction was rejected by users.'
    )
  }
}
