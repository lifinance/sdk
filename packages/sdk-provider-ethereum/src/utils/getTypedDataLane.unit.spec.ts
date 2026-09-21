import {
  type ExtendedChain,
  type LiFiStep,
  type TypedData,
  TypedDataPrimaryTypes,
} from '@lifi/sdk'
import { describe, expect, it } from 'vitest'
import {
  getTypedDataLane,
  hasPermit2Allowance,
  hasRelayerMessage,
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

const EXPECTED_LANES: Record<string, TypedDataLane> = {
  Permit: 'native-permit',
  PermitSingle: 'permit2-allowance',
  PermitBatch: 'relayer-message',
  PermitTransferFrom: 'relayer-message',
  PermitBatchTransferFrom: 'relayer-message',
  PermitWitnessTransferFrom: 'relayer-message',
  PermitBatchWitnessTransferFrom: 'relayer-message',
  Order: 'relayer-message',
  Agent: 'relayer-message',
  NonceMapping: 'relayer-message',
  'HyperliquidTransaction:UsdSend': 'relayer-message',
  'HyperliquidTransaction:SpotSend': 'relayer-message',
  'HyperliquidTransaction:SendAsset': 'relayer-message',
  'HyperliquidTransaction:Withdraw': 'relayer-message',
  'HyperliquidTransaction:ApproveAgent': 'relayer-message',
  'HyperliquidTransaction:ApproveBuilderFee': 'relayer-message',
}

describe('getTypedDataLane', () => {
  it('puts an EIP-2612 permit in the native-permit lane', () => {
    expect(getTypedDataLane(entry('Permit'), chain)).toBe('native-permit')
  })

  it('puts a PermitSingle for a third-party spender in the permit2-allowance lane', () => {
    expect(
      getTypedDataLane(entry('PermitSingle', UNIVERSAL_ROUTER), chain)
    ).toBe('permit2-allowance')
  })

  it("puts a relayer's native permit in the native-permit lane even though its spender is Permit2", () => {
    expect(getTypedDataLane(entry('Permit', PERMIT2), chain)).toBe(
      'native-permit'
    )
  })

  it('puts a gasless witness intent in the relayer-message lane', () => {
    expect(getTypedDataLane(entry('PermitWitnessTransferFrom'), chain)).toBe(
      'relayer-message'
    )
  })

  it('puts an unknown primary type in the relayer-message lane, preserving today behaviour', () => {
    expect(getTypedDataLane(entry('SomeFutureIntent'), chain)).toBe(
      'relayer-message'
    )
  })

  it('keeps a chain.permit2 spender in the relayer lane even for a PermitSingle type', () => {
    expect(getTypedDataLane(entry('PermitSingle', PERMIT2), chain)).toBe(
      'relayer-message'
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
    expect(getTypedDataLane(entry('PermitBatch'), chain)).toBe(
      'relayer-message'
    )
  })
})

describe('hasPermit2Allowance / hasRelayerMessage', () => {
  it('are both false for a step with no typed data', () => {
    const step = {} as unknown as LiFiStep
    expect(hasPermit2Allowance(step, chain)).toBe(false)
    expect(hasRelayerMessage(step, chain)).toBe(false)
  })

  it('report a Permit2 allowance alongside a native permit', () => {
    const step = stepWith('Permit', 'PermitSingle')
    expect(hasPermit2Allowance(step, chain)).toBe(true)
    expect(hasRelayerMessage(step, chain)).toBe(false)
  })

  it('report a relayer message for an Order step', () => {
    const step = stepWith('Order')
    expect(hasPermit2Allowance(step, chain)).toBe(false)
    expect(hasRelayerMessage(step, chain)).toBe(true)
  })
})
