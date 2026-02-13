import type {
  ExecutionActionType,
  ExtendedChain,
  LiFiStep,
  SDKClient,
  StatusManager,
} from '@lifi/sdk'
import type { Client, Hash } from 'viem'
import { waitForTransactionReceipt } from '../../../actions/waitForTransactionReceipt.js'

export const waitForApprovalTransaction = async (
  client: SDKClient,
  viemClient: Client,
  txHash: Hash,
  actionType: ExecutionActionType,
  step: LiFiStep,
  chain: ExtendedChain,
  statusManager: StatusManager,
  approvalReset: boolean = false
) => {
  const baseExplorerUrl = chain.metamask.blockExplorerUrls[0]
  const getTxLink = (hash: Hash) => `${baseExplorerUrl}tx/${hash}`

  statusManager.updateAction(step, actionType, 'PENDING', {
    txHash,
    txLink: getTxLink(txHash),
  })

  const transactionReceipt = await waitForTransactionReceipt(client, {
    client: viemClient,
    chainId: chain.id,
    txHash,
    onReplaced(response) {
      const newHash = response.transaction.hash
      statusManager.updateAction(step, actionType, 'PENDING', {
        txHash: newHash,
        txLink: getTxLink(newHash),
      })
    },
  })

  const finalHash = transactionReceipt?.transactionHash || txHash
  if (!approvalReset) {
    statusManager.updateAction(step, actionType, 'DONE', {
      txHash: finalHash,
      txLink: getTxLink(finalHash),
    })
  }
}
