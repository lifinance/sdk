import type { Address, Hash, TypedData, TypedDataDomain } from 'viem'

export type PermitSignature = {
  signature: Hash
}

export type NativePermitMessage = {
  owner: Address
  spender: Address
  nonce: string
  value: string
  deadline: string
}

export type NativePermitData = {
  primaryType: 'Permit'
  domain: TypedDataDomain
  types: TypedData
  message: NativePermitMessage
}
