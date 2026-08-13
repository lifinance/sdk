import type { LiFiStep, Step } from '@lifi/sdk'
import { Keypair, StrKey } from '@stellar/stellar-sdk'
import { describe, expect, it } from 'vitest'
import { resolveApprovalRequirement } from './resolveApprovalRequirement.js'

const CIRCLE_ADAPTER = StrKey.encodeContract(Buffer.alloc(32, 7))
const ROUTER = StrKey.encodeContract(Buffer.alloc(32, 3))
const XLM_USDC = StrKey.encodeContract(Buffer.alloc(32, 4))
const XLM_EURC = StrKey.encodeContract(Buffer.alloc(32, 5))
const EVM_DIAMOND = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'

const leg = (
  tokenAddress: string,
  fromAmount: string,
  approvalAddress: string,
  skipApproval?: boolean
): Step =>
  ({
    action: { fromToken: { address: tokenAddress } },
    estimate: { fromAmount, approvalAddress, skipApproval },
  }) as Step

// Fee collection and soroswap both move funds with SAC `transfer` under the
// sender's top-level auth, so they opt out; only the CCTP cross pulls with
// `transfer_from`.
const feeLeg = leg(XLM_EURC, '10', ROUTER, true)
const swapLeg = leg(XLM_EURC, '1000', Keypair.random().publicKey(), true)
const cctpLeg = leg(XLM_USDC, '990', CIRCLE_ADAPTER, false)

const stepWith = (includedSteps: Step[], approvalAddress = ROUTER): LiFiStep =>
  ({
    action: { fromToken: { address: XLM_EURC }, fromAmount: '1010' },
    estimate: { approvalAddress },
    includedSteps,
  }) as LiFiStep

describe('resolveApprovalRequirement', () => {
  it('takes spender and token from the leg that needs an approval', () => {
    expect(
      resolveApprovalRequirement(stepWith([feeLeg, swapLeg, cctpLeg]))
    ).toEqual({
      spender: CIRCLE_ADAPTER,
      // The intermediate token the swap produces, not the route's fromToken.
      tokenAddress: XLM_USDC,
      amount: 1089n,
    })
  })

  it('approves 10% above the leg amount', () => {
    // The leg is handed whatever the upstream swap actually produced, which can
    // exceed the quote; an allowance short by a stroop reverts the invocation.
    expect(
      resolveApprovalRequirement(stepWith([leg(XLM_USDC, '1000', ROUTER)]))
        ?.amount
    ).toBe(1100n)
  })

  it('requires no approval when every leg skips one', () => {
    expect(
      resolveApprovalRequirement(stepWith([feeLeg, swapLeg]))
    ).toBeUndefined()
  })

  it('approves a leg that leaves skipApproval unset', () => {
    // Only an explicit `skipApproval: true` opts out — same reading as the EVM
    // and Tron executors.
    expect(
      resolveApprovalRequirement(
        stepWith([feeLeg, leg(XLM_USDC, '990', ROUTER)])
      )
    ).toEqual({ spender: ROUTER, tokenAddress: XLM_USDC, amount: 1089n })
  })

  it('never falls back to the route-level estimate', () => {
    // A swap-only route summarises approvalAddress as the router placeholder.
    // Approving it would grant an allowance nothing ever consumes.
    expect(
      resolveApprovalRequirement(stepWith([feeLeg, swapLeg], ROUTER))
    ).toBeUndefined()
  })

  it('rejects a leg whose spender is not a Soroban contract', () => {
    expect(
      resolveApprovalRequirement(
        stepWith([leg(XLM_USDC, '990', EVM_DIAMOND, false)])
      )
    ).toBeUndefined()
    expect(
      resolveApprovalRequirement(
        stepWith([leg(XLM_USDC, '990', Keypair.random().publicKey(), false)])
      )
    ).toBeUndefined()
    expect(
      resolveApprovalRequirement(stepWith([leg(XLM_USDC, '990', '', false)]))
    ).toBeUndefined()
  })

  // The first leg needing an approval may name a placeholder spender. Bailing
  // out there left the CCTP leg that actually pulls funds with no allowance,
  // and the invocation reverted after the user had signed.
  it('skips a non-contract spender and keeps looking', () => {
    const placeholderLeg = leg(XLM_EURC, '1000', EVM_DIAMOND, false)

    expect(
      resolveApprovalRequirement(stepWith([placeholderLeg, cctpLeg]))
    ).toEqual({
      spender: CIRCLE_ADAPTER,
      tokenAddress: XLM_USDC,
      amount: 1089n,
    })
  })

  it('tolerates a step without included steps', () => {
    expect(
      resolveApprovalRequirement({
        action: { fromToken: { address: XLM_EURC }, fromAmount: '1010' },
        estimate: { approvalAddress: CIRCLE_ADAPTER },
      } as LiFiStep)
    ).toBeUndefined()
  })
})
