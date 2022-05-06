import { Provider } from '@ethersproject/abstract-provider'
import { Signer } from 'ethers'
import { LifiErrorCode, ProviderError } from './errors'

export const getProvider = (signer: Signer): Provider => {
  if (!signer.provider) {
    throw new ProviderError(
      LifiErrorCode.ProviderUnavailable,
      'No provider available in signer.'
    )
  }

  return signer.provider
}
