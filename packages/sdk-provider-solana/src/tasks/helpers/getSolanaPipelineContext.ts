import type {
  ExecutionActionType,
  ExecutionOptions,
  LiFiStepExtended,
  SDKClient,
  StatusManager,
  TaskContext,
} from '@lifi/sdk'
import { LiFiErrorCode, TransactionError } from '@lifi/sdk'
import type { Wallet } from '@wallet-standard/base'
import type { SolanaTaskExtra } from '../types.js'

export interface GetSolanaPipelineContextDeps {
  wallet: Wallet
  statusManager: StatusManager
  executionOptions?: ExecutionOptions
  allowUserInteraction: boolean
}

/**
 * Resolves chains, action type, action, and wallet account for the Solana task pipeline.
 * Returns baseContext ready for pipeline.run() / pipeline.resume().
 */
export async function getSolanaPipelineContext(
  client: SDKClient,
  step: LiFiStepExtended,
  deps: GetSolanaPipelineContextDeps
): Promise<Omit<TaskContext<SolanaTaskExtra>, 'pipelineContext'>> {
  const fromChain = await client.getChainById(step.action.fromChainId)
  const toChain = await client.getChainById(step.action.toChainId)

  const isBridgeExecution = fromChain.id !== toChain.id
  const currentActionType: ExecutionActionType = isBridgeExecution
    ? 'CROSS_CHAIN'
    : 'SWAP'

  const action = deps.statusManager.findOrCreateAction({
    step,
    type: currentActionType,
    chainId: fromChain.id,
  })

  const walletAccount = deps.wallet.accounts.find(
    (account) => account.address === step.action.fromAddress
  )

  if (!walletAccount) {
    throw new TransactionError(
      LiFiErrorCode.WalletChangedDuringExecution,
      'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
    )
  }

  return {
    client,
    step,
    chain: fromChain,
    allowUserInteraction: deps.allowUserInteraction,
    wallet: deps.wallet,
    walletAccount,
    statusManager: deps.statusManager,
    executionOptions: deps.executionOptions,
    fromChain,
    toChain,
    isBridgeExecution,
    actionType: currentActionType,
    action,
  }
}
