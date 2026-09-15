import type { SignedTypedData, TypedData } from '@lifi/sdk'
import type { Address, Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { isTypedDataAlreadySigned } from './isTypedDataAlreadySigned.js'

const SOURCE_CHAIN = 137
const FROM_ADDRESS = '0xaaaa000000000000000000000000000000000001' as Address
const TOKEN = '0xbbbb000000000000000000000000000000000002' as Address
const THIRD_PARTY_ROUTER =
  '0xcccc000000000000000000000000000000000003' as Address
const SIGNATURE = `0x${'11'.repeat(65)}` as Hex

const permitSingle = (overrides?: {
  domain?: Record<string, unknown>
  message?: Record<string, unknown>
}): TypedData =>
  ({
    primaryType: 'PermitSingle',
    domain: overrides?.domain ?? {
      name: 'Permit2',
      chainId: SOURCE_CHAIN,
      verifyingContract: TOKEN,
    },
    types: {},
    message: overrides?.message ?? {
      details: {
        token: TOKEN,
        amount: '1000000',
        expiration: '1900000000',
        nonce: '0',
      },
      spender: THIRD_PARTY_ROUTER,
      sigDeadline: '1900000000',
    },
  }) as unknown as TypedData

const signed = (
  typedData: TypedData,
  signature: Hex = SIGNATURE
): SignedTypedData => ({ ...typedData, signature })

const nativePermit = (): TypedData =>
  ({
    primaryType: 'Permit',
    domain: { chainId: SOURCE_CHAIN },
    types: {},
    message: {
      owner: FROM_ADDRESS,
      spender: THIRD_PARTY_ROUTER,
      value: '1000000',
      nonce: '0',
      deadline: '1900000000',
    },
  }) as unknown as TypedData

describe('isTypedDataAlreadySigned', () => {
  it('recognises an entry an equal record already covers', () => {
    expect(
      isTypedDataAlreadySigned([signed(permitSingle())], permitSingle())
    ).toBe(true)
  })

  it('ignores the key order of domain and message', () => {
    const record = signed(
      permitSingle({
        domain: {
          verifyingContract: TOKEN,
          chainId: SOURCE_CHAIN,
          name: 'Permit2',
        },
        message: {
          sigDeadline: '1900000000',
          spender: THIRD_PARTY_ROUTER,
          details: {
            nonce: '0',
            expiration: '1900000000',
            amount: '1000000',
            token: TOKEN,
          },
        },
      })
    )

    expect(isTypedDataAlreadySigned([record], permitSingle())).toBe(true)
  })

  it('treats a number, a bigint and a string of one value as equal', () => {
    const record = signed(
      permitSingle({
        domain: {
          name: 'Permit2',
          chainId: String(SOURCE_CHAIN),
          verifyingContract: TOKEN,
        },
        message: {
          details: {
            token: TOKEN,
            amount: 1000000n,
            expiration: 1900000000,
            nonce: 0,
          },
          spender: THIRD_PARTY_ROUTER,
          sigDeadline: '1900000000',
        },
      })
    )

    expect(isTypedDataAlreadySigned([record], permitSingle())).toBe(true)
  })

  it('rejects a record whose nested message field differs', () => {
    const record = signed(
      permitSingle({
        message: {
          details: {
            token: TOKEN,
            amount: '999999',
            expiration: '1900000000',
            nonce: '0',
          },
          spender: THIRD_PARTY_ROUTER,
          sigDeadline: '1900000000',
        },
      })
    )

    expect(isTypedDataAlreadySigned([record], permitSingle())).toBe(false)
  })

  it('rejects a record that drops a domain field', () => {
    const record = signed(
      permitSingle({ domain: { name: 'Permit2', chainId: SOURCE_CHAIN } })
    )

    expect(isTypedDataAlreadySigned([record], permitSingle())).toBe(false)
  })

  it('rejects a record with another primary type', () => {
    const record = signed({
      ...permitSingle(),
      primaryType: 'PermitWitnessTransferFrom',
    } as unknown as TypedData)

    expect(isTypedDataAlreadySigned([record], permitSingle())).toBe(false)
  })

  it('rejects a record whose signature is not usable', () => {
    expect(
      isTypedDataAlreadySigned(
        [signed(permitSingle(), '0x' as Hex)],
        permitSingle()
      )
    ).toBe(false)
  })

  it('never recognises a native permit, which keeps its own rules', () => {
    expect(
      isTypedDataAlreadySigned([signed(nativePermit())], nativePermit())
    ).toBe(false)
  })

  it('returns false for an empty record list', () => {
    expect(isTypedDataAlreadySigned([], permitSingle())).toBe(false)
  })
})
