import type { SignedTypedData, TypedData } from '@lifi/sdk'
import type { Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { isNativePermitValid } from './isNativePermitValid.js'

const OWNER = '0xaaaa000000000000000000000000000000000001'
const SPENDER = '0xbbbb000000000000000000000000000000000002'
const SIGNATURE = `0x${'11'.repeat(65)}` as Hex

const buildTypedData = (): TypedData =>
  ({
    primaryType: 'Permit',
    domain: { chainId: 1 },
    types: {},
    message: {
      owner: OWNER,
      spender: SPENDER,
      value: '1000000',
      nonce: '0',
      deadline: String(Math.floor(Date.now() / 1000) + 3600),
    },
  }) as TypedData

const buildPermit = (signature: Hex): SignedTypedData => ({
  ...buildTypedData(),
  signature,
})

describe('isNativePermitValid', () => {
  it('accepts a matching permit with a valid signature', () => {
    expect(isNativePermitValid(buildPermit(SIGNATURE), buildTypedData())).toBe(
      true
    )
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty hex', '0x'],
  ])('rejects a matching permit with a %s signature', (_, signature) => {
    expect(
      isNativePermitValid(buildPermit(signature as Hex), buildTypedData())
    ).toBe(false)
  })
})
