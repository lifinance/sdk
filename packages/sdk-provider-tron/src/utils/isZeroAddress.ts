export const AddressZero = '0x0000000000000000000000000000000000000000'

//Tron base58check encoding of 0x0000000000000000000000000000000000000000 (the EVM zero address).
export const TronAddressZero = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'

export const isZeroAddress = (address: string): boolean =>
  address === AddressZero || address === TronAddressZero
