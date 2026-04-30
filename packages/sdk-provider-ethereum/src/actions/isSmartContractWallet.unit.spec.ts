import { describe, expect, it } from 'vitest'
import { isSmartContractWalletCode } from './isSmartContractWallet.js'

describe('isSmartContractWalletCode', () => {
  it('returns false for undefined / missing code (EOA)', () => {
    expect(isSmartContractWalletCode(undefined)).toBe(false)
    expect(isSmartContractWalletCode()).toBe(false)
  })

  it('returns false for empty 0x code (EOA)', () => {
    expect(isSmartContractWalletCode('0x')).toBe(false)
  })

  it('returns false for an EIP-7702 delegation designator (delegated EOA still pays its own gas)', () => {
    // 0xef0100 || 20-byte target address
    const sevenSevenZeroTwo = '0xef0100a94f5374fce5edbc8e2a8697c15331677e6ebf0b'
    expect(isSmartContractWalletCode(sevenSevenZeroTwo)).toBe(false)
  })

  it('returns true for arbitrary non-empty bytecode (Safe / 4337 / 7579 / custom)', () => {
    expect(isSmartContractWalletCode('0x6080604052')).toBe(true)
    expect(isSmartContractWalletCode('0xabcdef01')).toBe(true)
  })
})
