import type { Address, Hex } from 'viem'
import {
  encodeAbiParameters,
  keccak256,
  pad,
  parseAbiParameters,
  toBytes,
  toHex,
} from 'viem'
import { describe, expect, it } from 'vitest'
import {
  EIP712_DOMAIN_TYPEHASH,
  EIP712_DOMAIN_TYPEHASH_WITH_SALT,
  EIP712_DOMAINS_WITHOUT_VERSION,
} from './constants.js'
import { validateDomainSeparator } from './getNativePermit.js'

const NAME = 'Test Token'
const VERSION = '1'
const CHAIN_ID = 1
const TOKEN = '0xaaaa000000000000000000000000000000000001' as Address

const withVersion = (): Hex => {
  const encoded = encodeAbiParameters(
    parseAbiParameters('bytes32, bytes32, bytes32, uint256, address'),
    [
      EIP712_DOMAIN_TYPEHASH,
      keccak256(toBytes(NAME)),
      keccak256(toBytes(VERSION)),
      BigInt(CHAIN_ID),
      TOKEN,
    ]
  )
  return keccak256(encoded)
}

const withSalt = (): Hex => {
  const encoded = encodeAbiParameters(
    parseAbiParameters('bytes32, bytes32, bytes32, address, bytes32'),
    [
      EIP712_DOMAIN_TYPEHASH_WITH_SALT,
      keccak256(toBytes(NAME)),
      keccak256(toBytes(VERSION)),
      TOKEN,
      pad(toHex(CHAIN_ID), { size: 32 }),
    ]
  )
  return keccak256(encoded)
}

const withoutVersion = (typeHash: Hex): Hex => {
  const encoded = encodeAbiParameters(
    parseAbiParameters('bytes32, bytes32, uint256, address'),
    [typeHash, keccak256(toBytes(NAME)), BigInt(CHAIN_ID), TOKEN]
  )
  return keccak256(encoded)
}

const base = {
  name: NAME,
  version: VERSION,
  chainId: CHAIN_ID,
  verifyingContract: TOKEN,
}

describe('validateDomainSeparator', () => {
  it('matches a domain separator that includes the version field', () => {
    const result = validateDomainSeparator({
      ...base,
      domainSeparator: withVersion(),
    })

    expect(result.isValid).toBe(true)
    expect(result.domain).toEqual({
      name: NAME,
      version: VERSION,
      chainId: CHAIN_ID,
      verifyingContract: TOKEN,
    })
  })

  it('matches a domain separator that includes a salt', () => {
    const result = validateDomainSeparator({
      ...base,
      domainSeparator: withSalt(),
    })

    expect(result.isValid).toBe(true)
    expect(result.domain).toEqual({
      name: NAME,
      version: VERSION,
      verifyingContract: TOKEN,
      salt: pad(toHex(CHAIN_ID), { size: 32 }),
    })
  })

  it('matches a domain separator without a version field', () => {
    for (const typeHash of EIP712_DOMAINS_WITHOUT_VERSION) {
      const result = validateDomainSeparator({
        ...base,
        domainSeparator: withoutVersion(typeHash),
      })

      expect(result.isValid).toBe(true)
      expect(result.domain).toEqual({
        name: NAME,
        chainId: CHAIN_ID,
        verifyingContract: TOKEN,
      })
    }
  })

  it('rejects a separator built from a different name', () => {
    const result = validateDomainSeparator({
      ...base,
      name: 'Other Token',
      domainSeparator: withVersion(),
    })

    expect(result.isValid).toBe(false)
    expect(result.domain).toEqual({})
  })
})
