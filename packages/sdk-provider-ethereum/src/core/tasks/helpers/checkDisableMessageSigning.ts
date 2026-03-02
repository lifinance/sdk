import { isSafeWallet } from '../../../actions/isSafeWallet.js'
import type { EthereumStepExecutorContext } from '../../../types.js'

export const checkDisableMessageSigning = async (
  context: EthereumStepExecutorContext
) => {
  const {
    step,
    fromChain,
    client,
    executionOptions,
    checkClient,
    ethereumClient,
    disableMessageSigning: disableMessageSigningContext,
  } = context

  if (disableMessageSigningContext !== undefined) {
    return disableMessageSigningContext
  }

  // Check if message signing is disabled - useful for smart contract wallets
  // We also disable message signing for custom steps
  const disableMessageSigning =
    executionOptions?.disableMessageSigning || step.type !== 'lifi'

  if (disableMessageSigning) {
    return true
  }

  const updatedClient = (await checkClient(step)) ?? ethereumClient
  const isAddressSafeWallet = updatedClient.account?.address
    ? await isSafeWallet(client, {
        chainId: fromChain.id,
        address: updatedClient.account.address,
        viemClient: updatedClient,
      })
    : false

  return isAddressSafeWallet
}
