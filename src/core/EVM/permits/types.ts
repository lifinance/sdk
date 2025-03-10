import type { Address, Hash, TypedData, TypedDataDomain } from 'viem'
import type {
  PermitBatchTransferFrom,
  PermitTransferFrom,
} from './signatureTransfer.js'

export type PermitSignature = {
  signature: Hash
}

export type NativePermitValues = {
  owner: Address
  spender: Address
  nonce: bigint
  value: bigint
  deadline: bigint
}

export type NativePermitData = {
  domain: TypedDataDomain
  types: TypedData
  values: NativePermitValues
}

export type NativePermitSignature = PermitSignature & {
  values: NativePermitValues
}

export type Permit2Signature<
  T extends PermitTransferFrom | PermitBatchTransferFrom,
> = PermitSignature & {
  values: T
}
