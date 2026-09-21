import type { ExtendedChain, LiFiStep, TypedData } from '@lifi/sdk'
import { describe, expect, it } from 'vitest'
import { preservePermit2Allowances } from './preservePermit2Allowances.js'

const SOURCE_CHAIN = 1
// A `spender` equal to `chain.permit2` makes an entry a relayer message, so no
// permit2-allowance fixture may use PERMIT2 as its spender.
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const VERIFYING_CONTRACT = '0x0000000000225e31d15943971f47ad3022f714fa'
const UNIVERSAL_ROUTER = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af'

const chain = {
  id: SOURCE_CHAIN,
  permit2: PERMIT2,
} as unknown as ExtendedChain

const permit2Allowance = (): TypedData =>
  ({
    primaryType: 'PermitSingle',
    domain: { chainId: SOURCE_CHAIN, verifyingContract: VERIFYING_CONTRACT },
    types: {},
    message: { spender: UNIVERSAL_ROUTER },
  }) as unknown as TypedData

const witness = (): TypedData =>
  ({
    primaryType: 'PermitWitnessTransferFrom',
    domain: { chainId: SOURCE_CHAIN, verifyingContract: VERIFYING_CONTRACT },
    types: {},
    message: {},
  }) as unknown as TypedData

const nativePermit = (): TypedData =>
  ({
    primaryType: 'Permit',
    domain: { chainId: SOURCE_CHAIN, verifyingContract: VERIFYING_CONTRACT },
    types: {},
    message: { spender: '0xcccc000000000000000000000000000000000003' },
  }) as unknown as TypedData

const stepWith = (typedData?: TypedData[]): LiFiStep =>
  ({
    type: 'lifi',
    id: 'step-1',
    action: { fromChainId: SOURCE_CHAIN },
    estimate: {},
    ...(typedData ? { typedData } : {}),
  }) as unknown as LiFiStep

describe('preservePermit2Allowances', () => {
  it('keeps a Permit2 allowance when the API answers with an empty typedData array', () => {
    const step = stepWith([permit2Allowance()])

    const result = preservePermit2Allowances(step, [], chain)

    expect(result).toHaveLength(1)
    expect(result?.[0].primaryType).toBe('PermitSingle')
  })

  it('keeps the API answer verbatim when it already carries a Permit2 allowance', () => {
    const step = stepWith([permit2Allowance()])
    const answer = [permit2Allowance()]

    expect(preservePermit2Allowances(step, answer, chain)).toBe(answer)
  })

  it('returns the API answer when it carries only a relayer message, dropping the stale Permit2 allowance', () => {
    const step = stepWith([permit2Allowance()])
    const answer = [witness()]

    expect(preservePermit2Allowances(step, answer, chain)).toBe(answer)
  })

  it('returns the previous typedData when the API omits the field entirely', () => {
    const declaration = [permit2Allowance()]
    const step = stepWith(declaration)

    expect(preservePermit2Allowances(step, undefined, chain)).toBe(declaration)
  })

  it('returns an empty array unchanged when the step never had a Permit2 allowance', () => {
    const answer: TypedData[] = []

    expect(preservePermit2Allowances(stepWith(), answer, chain)).toBe(answer)
    expect(
      preservePermit2Allowances(stepWith([nativePermit()]), answer, chain)
    ).toBe(answer)
  })

  it('clears a relayer step completely, Permit2 allowance included', () => {
    const step = stepWith([witness(), permit2Allowance()])

    expect(preservePermit2Allowances(step, [], chain)).toHaveLength(0)
  })

  it('appends only the Permit2 allowance, not the rest of the previous typed data', () => {
    const step = stepWith([nativePermit(), permit2Allowance()])

    const result = preservePermit2Allowances(step, [], chain)

    expect(result?.map((typedData) => typedData.primaryType)).toEqual([
      'PermitSingle',
    ])
  })

  it('keeps the Permit2 allowance beside a native permit the API added', () => {
    const step = stepWith([permit2Allowance()])

    const result = preservePermit2Allowances(step, [nativePermit()], chain)

    expect(result?.map((typedData) => typedData.primaryType)).toEqual([
      'Permit',
      'PermitSingle',
    ])
  })
})
