import {
  type ExtendedChain,
  type LiFiStep,
  type TypedData,
  TypedDataPrimaryTypes,
} from '@lifi/sdk'
import { describe, expect, it } from 'vitest'
import {
  getTypedDataLane,
  hasCallerIntent,
  hasRelayerIntent,
  type TypedDataLane,
} from './getTypedDataLane.js'

const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const UNIVERSAL_ROUTER = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af'

const chain = { id: 1, permit2: PERMIT2 } as unknown as ExtendedChain

const entry = (primaryType: string, spender?: string): TypedData =>
  ({
    primaryType,
    domain: { chainId: 1, verifyingContract: PERMIT2 },
    types: {},
    message: spender ? { spender } : {},
  }) as unknown as TypedData

const stepWith = (...primaryTypes: string[]): LiFiStep =>
  ({ typedData: primaryTypes.map((t) => entry(t)) }) as unknown as LiFiStep

// Every value @lifi/types declares, plus `PermitBatch`, which the API can send
// before the types package knows it. A new primary type with no entry here
// fails the exhaustiveness test below, which forces a deliberate lane decision.
const EXPECTED_LANES: Record<string, TypedDataLane> = {
  Permit: 'native-permit',
  PermitSingle: 'caller-intent',
  PermitBatch: 'relayer-intent',
  PermitTransferFrom: 'relayer-intent',
  PermitBatchTransferFrom: 'relayer-intent',
  PermitWitnessTransferFrom: 'relayer-intent',
  PermitBatchWitnessTransferFrom: 'relayer-intent',
  Order: 'relayer-intent',
  Agent: 'relayer-intent',
  NonceMapping: 'relayer-intent',
  'HyperliquidTransaction:UsdSend': 'relayer-intent',
  'HyperliquidTransaction:SpotSend': 'relayer-intent',
  'HyperliquidTransaction:SendAsset': 'relayer-intent',
  'HyperliquidTransaction:Withdraw': 'relayer-intent',
  'HyperliquidTransaction:ApproveAgent': 'relayer-intent',
  'HyperliquidTransaction:ApproveBuilderFee': 'relayer-intent',
}

describe('getTypedDataLane', () => {
  it('puts an EIP-2612 permit in the native-permit lane', () => {
    expect(getTypedDataLane(entry('Permit'), chain)).toBe('native-permit')
  })

  it('puts a PermitSingle for a third-party spender in the caller-intent lane', () => {
    expect(
      getTypedDataLane(entry('PermitSingle', UNIVERSAL_ROUTER), chain)
    ).toBe('caller-intent')
  })

  it("puts a relayer's native permit in the native-permit lane even though its spender is Permit2", () => {
    // LI.FI's gasless relayer emits an EIP-2612 permit whose `message.spender`
    // is the canonical Permit2 (gasless `src/signature/payload.ts`). It must
    // still reach `EthereumCheckPermitsTask`, so the native-permit rule is
    // decided before the gasless rule.
    expect(getTypedDataLane(entry('Permit', PERMIT2), chain)).toBe(
      'native-permit'
    )
  })

  it('puts a gasless witness intent in the relayer-intent lane', () => {
    // The lane is pinned here; the RULE that produces it is not. A witness
    // entry with no spender also reaches `relayer-intent` through the default
    // branch, so deleting the witness clause of rule 1 is an equivalent mutant
    // within this module. That clause is pinned by `isGaslessStep.unit.spec.ts`.
    expect(getTypedDataLane(entry('PermitWitnessTransferFrom'), chain)).toBe(
      'relayer-intent'
    )
  })

  it('puts an unknown primary type in the relayer-intent lane, preserving today behaviour', () => {
    expect(getTypedDataLane(entry('SomeFutureIntent'), chain)).toBe(
      'relayer-intent'
    )
  })

  it('keeps a chain.permit2 spender in the relayer lane even for a caller-intent type', () => {
    // The relayer clause is tested ahead of the caller-intent rule on purpose:
    // no caller-intent type may escape into the inline-signing path.
    expect(getTypedDataLane(entry('PermitSingle', PERMIT2), chain)).toBe(
      'relayer-intent'
    )
  })

  it('assigns a lane to every primary type @lifi/types declares', () => {
    for (const primaryType of TypedDataPrimaryTypes) {
      expect(EXPECTED_LANES[primaryType]).toBeDefined()
      expect(getTypedDataLane(entry(primaryType), chain)).toBe(
        EXPECTED_LANES[primaryType]
      )
    }
  })

  it('classifies PermitBatch, which @lifi/types does not declare yet', () => {
    // Excluded from the caller-intent rule on purpose: `details` covers several
    // tokens, while the allowance path is single-token. `PermitSingle` needs no
    // case here — 18.6.0 declares it, so the exhaustiveness loop covers it.
    expect(getTypedDataLane(entry('PermitBatch'), chain)).toBe('relayer-intent')
  })
})

describe('hasCallerIntent / hasRelayerIntent', () => {
  it('are both false for a step with no typed data', () => {
    const step = {} as unknown as LiFiStep
    expect(hasCallerIntent(step, chain)).toBe(false)
    expect(hasRelayerIntent(step, chain)).toBe(false)
  })

  it('report a caller intent alongside a native permit', () => {
    const step = stepWith('Permit', 'PermitSingle')
    expect(hasCallerIntent(step, chain)).toBe(true)
    expect(hasRelayerIntent(step, chain)).toBe(false)
  })

  it('report a relayer intent for an Order step', () => {
    const step = stepWith('Order')
    expect(hasCallerIntent(step, chain)).toBe(false)
    expect(hasRelayerIntent(step, chain)).toBe(true)
  })
})
