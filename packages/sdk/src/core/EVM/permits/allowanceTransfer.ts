import {
  type Address,
  hashTypedData,
  type TypedData,
  type TypedDataDomain,
} from 'viem'
import { MaxUint48, MaxUint160 } from '../../../constants.js'
import { invariant } from '../../../utils/invariant.js'
import { MaxSigDeadline } from './constants.js'
import { permit2Domain } from './domain.js'

export const MaxAllowanceTransferAmount = MaxUint160
export const MaxAllowanceExpiration = MaxUint48
export const MaxOrderedNonce = MaxUint48

export interface PermitDetails {
  token: Address
  amount: bigint
  expiration: number
  nonce: number
}

export interface PermitSingle {
  details: PermitDetails
  spender: Address
  sigDeadline: bigint
}

export interface PermitBatch {
  details: PermitDetails[]
  spender: Address
  sigDeadline: bigint
}

export type PermitSingleData = {
  domain: TypedDataDomain
  types: TypedData
  message: PermitSingle
}

export type PermitBatchData = {
  domain: TypedDataDomain
  types: TypedData
  message: PermitBatch
}

const PERMIT_DETAILS = [
  { name: 'token', type: 'address' },
  { name: 'amount', type: 'uint160' },
  { name: 'expiration', type: 'uint48' },
  { name: 'nonce', type: 'uint48' },
] as const

const PERMIT_TYPES = {
  PermitDetails: PERMIT_DETAILS,
  PermitSingle: [
    { name: 'details', type: 'PermitDetails' },
    { name: 'spender', type: 'address' },
    { name: 'sigDeadline', type: 'uint256' },
  ],
} as const

const PERMIT_BATCH_TYPES = {
  PermitDetails: PERMIT_DETAILS,
  PermitBatch: [
    { name: 'details', type: 'PermitDetails[]' },
    { name: 'spender', type: 'address' },
    { name: 'sigDeadline', type: 'uint256' },
  ],
} as const

function isPermit(permit: PermitSingle | PermitBatch): permit is PermitSingle {
  return !Array.isArray(permit.details)
}

export function getPermitSingleData(
  permit: PermitSingle,
  permit2Address: Address,
  chainId: number
) {
  invariant(MaxSigDeadline >= permit.sigDeadline, 'SIG_DEADLINE_OUT_OF_RANGE')

  const domain = permit2Domain(permit2Address, chainId)
  validatePermitDetails(permit.details)

  return {
    domain,
    message: permit,
  }
}

export function getPermitBatchData(
  permit: PermitBatch,
  permit2Address: Address,
  chainId: number
) {
  invariant(MaxSigDeadline >= permit.sigDeadline, 'SIG_DEADLINE_OUT_OF_RANGE')

  const domain = permit2Domain(permit2Address, chainId)
  permit.details.forEach(validatePermitDetails)

  return {
    domain,
    message: permit,
  }
}

export function getPermitData(
  permit: PermitSingle | PermitBatch,
  permit2Address: Address,
  chainId: number
): PermitSingleData | PermitBatchData {
  invariant(MaxSigDeadline >= permit.sigDeadline, 'SIG_DEADLINE_OUT_OF_RANGE')

  const domain = permit2Domain(permit2Address, chainId)
  if (isPermit(permit)) {
    validatePermitDetails(permit.details)
    return {
      domain,
      types: PERMIT_TYPES,
      message: permit,
    }
  }
  permit.details.forEach(validatePermitDetails)
  return {
    domain,
    types: PERMIT_BATCH_TYPES,
    message: permit,
  }
}

export function hash(
  permit: PermitSingle | PermitBatch,
  permit2Address: Address,
  chainId: number
): string {
  if (isPermit(permit)) {
    const { domain, message } = getPermitSingleData(
      permit,
      permit2Address,
      chainId
    )

    return hashTypedData({
      domain,
      types: PERMIT_TYPES,
      primaryType: 'PermitSingle',
      message: message,
    })
  }
  const { domain, message } = getPermitBatchData(
    permit,
    permit2Address,
    chainId
  )

  return hashTypedData({
    domain,
    types: PERMIT_BATCH_TYPES,
    primaryType: 'PermitBatch',
    message: message,
  })
}

function validatePermitDetails(details: PermitDetails) {
  invariant(MaxOrderedNonce >= details.nonce, 'NONCE_OUT_OF_RANGE')
  invariant(MaxAllowanceTransferAmount >= details.amount, 'AMOUNT_OUT_OF_RANGE')
  invariant(
    MaxAllowanceExpiration >= details.expiration,
    'EXPIRATION_OUT_OF_RANGE'
  )
}
