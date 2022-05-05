import { Provider } from '@ethersproject/abstract-provider'
import { Signer } from 'ethers'
import { LifiErrorCodes, ProviderError } from './errors'

export const getProvider = (signer: Signer): Provider => {
  if (!signer.provider) {
    throw new ProviderError(
      LifiErrorCodes.noProviderAvailable,
      'No provider available in signer.'
    )
  }

  return signer.provider
}
