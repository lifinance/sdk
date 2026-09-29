import type { SDKClient } from '@lifi/sdk'
import type { Address, Hex } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./canAccountUseNativePermits.js', () => ({
  canAccountUseNativePermits: vi.fn(),
}))
vi.mock('../actions/getMulticallAddress.js', () => ({
  getMulticallAddress: vi.fn(),
}))
vi.mock('../utils/getActionWithFallback.js', () => ({
  getActionWithFallback: vi.fn(),
}))

import { getMulticallAddress } from '../actions/getMulticallAddress.js'
import { getActionWithFallback } from '../utils/getActionWithFallback.js'
import { canAccountUseNativePermits } from './canAccountUseNativePermits.js'
import { getNativePermit, validateDomainSeparator } from './getNativePermit.js'

const sdkClient = {} as SDKClient
const viemClient = {} as never

const NAME = 'Test Token'
const CHAIN_ID = 42161
const VERIFYING_CONTRACT =
  '0xaaaa000000000000000000000000000000000001' as Address
const OWNER = '0xbbbb000000000000000000000000000000000002' as Address
const SPENDER = '0xcccc000000000000000000000000000000000003' as Address

// keccak256('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)')
const EIP2612_PERMIT_TYPEHASH =
  '0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9' as Hex

// Every separator below was derived independently of this package, from
// keccak256(abi.encode(typehash, nameHash, ...)) for the named EIP-712
// signature, so the assertions do not re-use the code under test.
//
// keccak256('EIP712Domain(string name,uint chainId,address verifyingContract)')
// keccak256('EIP712Domain(string name,uint256 chainId,address verifyingContract)')
// keccak256('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')
// keccak256('EIP712Domain(string name,string version,address verifyingContract,bytes32 salt)')
const DS_NO_VERSION_UINT =
  '0xab0f0781222e3e819bc7d4c7a2cd19077f4a11952271cdce6ef72e727493c798' as Hex
const DS_NO_VERSION_UINT256 =
  '0x4c36720409a529952f23375ca26cdcfb21b5a59ec935887beccc3ebb8efcf94a' as Hex
const DS_WITH_VERSION =
  '0x2f84b8700e2a9bbc019ff4cc961850355ef681246cd263f5e52c5fec3f768346' as Hex
const DS_WITH_VERSION_AND_SALT =
  '0xf5804b37c0a7f65baa85de7f15f6ed1ec3097397307f6ac9d92a9cabfc40070f' as Hex
const DS_UNKNOWN =
  '0x00000000000000000000000000000000000000000000000000000000deadbeef' as Hex

/**
 * Drives the legacy `getContractData` path — the one that reads
 * `DOMAIN_SEPARATOR` off the token and validates it — by answering each
 * `readContract` call with the value the test wants to see.
 */
const stubContractReads = (domainSeparator: Hex, version = '1') => {
  vi.mocked(getActionWithFallback).mockImplementation((async (
    _client: unknown,
    _wc: unknown,
    _fn: unknown,
    _name: unknown,
    call: { functionName: string }
  ) => {
    switch (call.functionName) {
      case 'name':
        return NAME
      case 'DOMAIN_SEPARATOR':
        return domainSeparator
      case 'PERMIT_TYPEHASH':
        return EIP2612_PERMIT_TYPEHASH
      case 'nonces':
        return 7n
      case 'version':
        return version
      default:
        throw new Error(`unexpected call ${call.functionName}`)
    }
  }) as never)
}

const subject = () =>
  getNativePermit(viemClient, {
    // `GetNativePermitParams` declares `viemClient` even though the
    // implementation reads it from the first argument, so the object has to
    // carry it to typecheck.
    viemClient,
    client: sdkClient,
    chainId: CHAIN_ID,
    tokenAddress: VERIFYING_CONTRACT,
    spenderAddress: SPENDER,
    amount: 1000n,
    ownerAddress: OWNER,
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(canAccountUseNativePermits).mockResolvedValue(true)
  // No multicall address, so the read falls through to the per-call branch.
  vi.mocked(getMulticallAddress).mockResolvedValue(undefined)
})

describe('validateDomainSeparator — no-version domain shapes', () => {
  it('matches a separator built with the `uint chainId` typehash', () => {
    // The regression: this shape matched neither with-version branch, so a
    // token that supports a gasless permit was reported as not supporting one
    // and the caller paid for a separate approval transaction.
    const { isValid, domain } = validateDomainSeparator({
      name: NAME,
      version: '1',
      chainId: CHAIN_ID,
      verifyingContract: VERIFYING_CONTRACT,
      domainSeparator: DS_NO_VERSION_UINT,
    })

    expect(isValid).toBe(true)
    expect(domain).toEqual({
      name: NAME,
      chainId: CHAIN_ID,
      verifyingContract: VERIFYING_CONTRACT,
    })
  })

  it('matches a separator built with the `uint256 chainId` typehash', () => {
    // `uint` and `uint256` are the same type on the wire, so both typehashes
    // must be tried; only the hashed signature string differs.
    const { isValid, domain } = validateDomainSeparator({
      name: NAME,
      version: '1',
      chainId: CHAIN_ID,
      verifyingContract: VERIFYING_CONTRACT,
      domainSeparator: DS_NO_VERSION_UINT256,
    })

    expect(isValid).toBe(true)
    expect(domain).toEqual({
      name: NAME,
      chainId: CHAIN_ID,
      verifyingContract: VERIFYING_CONTRACT,
    })
  })

  it('leaves no `version` in the returned domain', () => {
    // The signature has to reproduce the contract's own separator, and that
    // separator has no version field. Carrying one over would sign a payload
    // the token rejects.
    const { domain } = validateDomainSeparator({
      name: NAME,
      version: '1',
      chainId: CHAIN_ID,
      verifyingContract: VERIFYING_CONTRACT,
      domainSeparator: DS_NO_VERSION_UINT256,
    })

    expect(domain).not.toHaveProperty('version')
  })

  it('still matches the with-version shapes (no shadowing)', () => {
    const plain = validateDomainSeparator({
      name: NAME,
      version: '1',
      chainId: CHAIN_ID,
      verifyingContract: VERIFYING_CONTRACT,
      domainSeparator: DS_WITH_VERSION,
    })
    expect(plain.isValid).toBe(true)
    expect(plain.domain).toEqual({
      name: NAME,
      version: '1',
      chainId: CHAIN_ID,
      verifyingContract: VERIFYING_CONTRACT,
    })

    const salted = validateDomainSeparator({
      name: NAME,
      version: '1',
      chainId: CHAIN_ID,
      verifyingContract: VERIFYING_CONTRACT,
      domainSeparator: DS_WITH_VERSION_AND_SALT,
    })
    expect(salted.isValid).toBe(true)
    expect(salted.domain).toMatchObject({ name: NAME, version: '1' })
    expect(salted.domain).toHaveProperty('salt')
  })

  it('rejects a separator that matches no known shape', () => {
    // Guards the new branch from widening into "accept anything".
    const { isValid, domain } = validateDomainSeparator({
      name: NAME,
      version: '1',
      chainId: CHAIN_ID,
      verifyingContract: VERIFYING_CONTRACT,
      domainSeparator: DS_UNKNOWN,
    })

    expect(isValid).toBe(false)
    expect(domain).toEqual({})
  })

  it('bails out when the token reports no name', () => {
    const { isValid } = validateDomainSeparator({
      name: '',
      version: '1',
      chainId: CHAIN_ID,
      verifyingContract: VERIFYING_CONTRACT,
      domainSeparator: DS_NO_VERSION_UINT,
    })

    expect(isValid).toBe(false)
  })
})

describe('getNativePermit — no-version domains reach the permit flow', () => {
  it('returns a permit for a no-version token instead of falling back to approve', async () => {
    stubContractReads(DS_NO_VERSION_UINT)

    const permit = await subject()

    expect(permit).toBeDefined()
    expect(permit?.domain).toEqual({
      name: NAME,
      chainId: CHAIN_ID,
      verifyingContract: VERIFYING_CONTRACT,
    })
    expect(permit?.message).toMatchObject({
      owner: OWNER,
      spender: SPENDER,
      value: '1000',
      nonce: '7',
    })
  })

  it('returns a permit for the `uint256` no-version variant too', async () => {
    stubContractReads(DS_NO_VERSION_UINT256)

    const permit = await subject()

    expect(permit).toBeDefined()
    expect(permit?.domain).not.toHaveProperty('version')
  })

  it('returns undefined for a separator that matches no known shape', async () => {
    stubContractReads(DS_UNKNOWN)

    expect(await subject()).toBeUndefined()
  })
})
