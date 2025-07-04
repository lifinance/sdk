import { AddressZero, AlternativeAddressZero } from '../constants.js'

export const isZeroAddress = (address: string): boolean => {
  if (address === AddressZero || address === AlternativeAddressZero) {
    return true
  }
  return false
}

export const isNativeTokenAddress = (address: string): boolean => {
  if (
    address === AddressZero ||
    address === AlternativeAddressZero ||
    // Celo native token
    address === '0x471ece3750da237f93b8e339c536989b8978a438' ||
    // Metis native token
    address === '0xDeadDeAddeAddEAddeadDEaDDEAdDeaDDeAD0000'
  ) {
    return true
  }
  return false
}
