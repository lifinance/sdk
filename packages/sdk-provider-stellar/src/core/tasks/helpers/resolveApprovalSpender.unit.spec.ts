import type { LiFiStep } from '@lifi/sdk'
import { Keypair, StrKey } from '@stellar/stellar-sdk'
import { describe, expect, it } from 'vitest'
import { resolveApprovalSpender } from './resolveApprovalSpender.js'

const CONTRACT_ADDRESS = StrKey.encodeContract(Buffer.alloc(32, 7))

const stepWith = (approvalAddress?: string): LiFiStep =>
  ({ estimate: { approvalAddress } }) as LiFiStep

describe('resolveApprovalSpender', () => {
  it('returns a valid Soroban contract address from the estimate', () => {
    expect(resolveApprovalSpender(stepWith(CONTRACT_ADDRESS))).toBe(
      CONTRACT_ADDRESS
    )
  })

  it('rejects the G-address fallback wallet the backend sends for soroswap', () => {
    const fallbackWallet = Keypair.random().publicKey()
    expect(resolveApprovalSpender(stepWith(fallbackWallet))).toBeUndefined()
  })

  it('rejects the EVM diamond the backend sends for polymer/nearIntents', () => {
    expect(
      resolveApprovalSpender(
        stepWith('0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE')
      )
    ).toBeUndefined()
  })

  it('returns undefined for an absent or empty approvalAddress', () => {
    expect(resolveApprovalSpender(stepWith(undefined))).toBeUndefined()
    expect(resolveApprovalSpender(stepWith(''))).toBeUndefined()
  })

  it('prefers the override over the estimate', () => {
    const override = StrKey.encodeContract(Buffer.alloc(32, 9))
    expect(resolveApprovalSpender(stepWith(CONTRACT_ADDRESS), override)).toBe(
      override
    )
  })

  it('uses the override even when the estimate carries a placeholder', () => {
    expect(
      resolveApprovalSpender(
        stepWith('0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'),
        CONTRACT_ADDRESS
      )
    ).toBe(CONTRACT_ADDRESS)
  })
})
