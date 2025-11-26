import { payments } from 'bitcoinjs-lib'
import { describe, expect, it } from 'vitest'
import { generateRedeemScript } from './generateRedeemScript.js'

describe('generateRedeemScript', () => {
  it('should generate redeem script for P2SH address', () => {
    // Use a valid 33-byte compressed public key
    const publicKey = new Uint8Array(33)
    publicKey[0] = 0x02
    publicKey.fill(0x01, 1, 33)

    const redeemScript = generateRedeemScript(publicKey)

    expect(redeemScript).toBeDefined()
    expect(redeemScript).toBeInstanceOf(Uint8Array)
    expect(redeemScript!.length).toBeGreaterThan(0)

    // Verify it's the same as calling payments.p2wpkh directly
    const expected = payments.p2wpkh({ pubkey: publicKey }).output
    expect(redeemScript).toEqual(expected)
  })
})
