import type { Hex } from 'viem'
import { MaxUint48, MaxUint160, MaxUint256 } from '../../../constants.js'

export const MaxAllowanceTransferAmount = MaxUint160
export const MaxAllowanceExpiration = MaxUint48
export const MaxOrderedNonce = MaxUint48

export const MaxSignatureTransferAmount = MaxUint256
export const MaxUnorderedNonce = MaxUint256
export const MaxSigDeadline = MaxUint256

export const InstantExpiration = 0n

export const EIP_2612_PERMIT_SELECTOR = '0xd505accf'
export const DAI_PERMIT_SELECTOR = '0x8fcbaf0c'

/**
 * EIP-712 domain typehash with chainId
 * @link https://eips.ethereum.org/EIPS/eip-712#specification
 *
 * keccak256(toBytes(
 *   'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'
 * ))
 */
export const EIP712_DOMAIN_TYPEHASH =
  '0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f' as Hex

/**
 * EIP-712 domain typehash with salt (e.g. USDC.e on Polygon)
 * @link https://eips.ethereum.org/EIPS/eip-712#specification
 *
 * keccak256(toBytes(
 *   'EIP712Domain(string name,string version,address verifyingContract,bytes32 salt)'
 * ))
 */
export const EIP712_DOMAIN_TYPEHASH_WITH_SALT =
  '0x36c25de3e541d5d970f66e4210d728721220fff5c077cc6cd008b3a0c62adab7' as Hex

export const EIP712_DOMAINS_WITHOUT_VERSION = [
  /** @signature 'EIP712Domain(string name,uint chainId,address verifyingContract)' */
  '0x797cfab58fcb15f590eb8e4252d5c228ff88f94f907e119e80c4393a946e8f35' as Hex,
  /** @signature 'EIP712Domain(string name,uint256 chainId,address verifyingContract)' */
  '0x8cad95687ba82c2ce50e74f7b754645e5117c3a5bec8151c0726d5857980a866' as Hex,
]

/**
 * @signature Permit(address holder,address spender,uint256 nonce,uint256 expiry,bool allowed)
 * */
export const DAI_LIKE_PERMIT_TYPEHASH =
  '0xea2aa0a1be11a07ed86d755c93467f4f82362b452371d1ba94d1715123511acb' as Hex

/**
 * @example `${tokenAddress}:${chainId}.toLowerCase()`
 * @warning Only toLowerCase string
 * */
export const TOKEN_ADDRESSES_WITH_SALT = [
  '0x2791bca1f2de4661ed88a30c99a7a9449aa84174:137', // USDC Proxy Polygon
  '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063:137', // DAI Proxy Polygon
]

// EIP-2612 types
// https://eips.ethereum.org/EIPS/eip-2612
export const eip2612Types = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const

// DAI on Ethereum
export const daiPermitTypes = {
  Permit: [
    { name: 'holder', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
    { name: 'allowed', type: 'bool' },
  ],
} as const
