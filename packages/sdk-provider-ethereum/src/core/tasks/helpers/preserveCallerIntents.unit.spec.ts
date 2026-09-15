import type { ExtendedChain, LiFiStep, TypedData } from '@lifi/sdk'
import { describe, expect, it } from 'vitest'
import { preserveCallerIntents } from './preserveCallerIntents.js'

const SOURCE_CHAIN = 1
// A `spender` equal to `chain.permit2` makes an entry a relayer intent, so no
// caller-intent fixture may use PERMIT2 as its spender.
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const VERIFYING_CONTRACT = '0x0000000000225e31d15943971f47ad3022f714fa'
const UNIVERSAL_ROUTER = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af'

const chain = {
  id: SOURCE_CHAIN,
  permit2: PERMIT2,
} as unknown as ExtendedChain

const callerIntent = (): TypedData =>
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

describe('preserveCallerIntents', () => {
  it('keeps a caller intent when the API answers with an empty typedData array', () => {
    const step = stepWith([callerIntent()])

    const result = preserveCallerIntents(step, [], chain)

    expect(result).toHaveLength(1)
    expect(result?.[0].primaryType).toBe('PermitSingle')
  })

  it('keeps the API answer verbatim when it already carries a caller intent', () => {
    const step = stepWith([callerIntent()])
    const answer = [callerIntent()]

    expect(preserveCallerIntents(step, answer, chain)).toBe(answer)
  })

  it('returns the API answer when it carries only a relayer intent, dropping the stale caller intent', () => {
    const step = stepWith([callerIntent()])
    const answer = [witness()]

    expect(preserveCallerIntents(step, answer, chain)).toBe(answer)
  })

  it('returns the previous typedData when the API omits the field entirely', () => {
    const declaration = [callerIntent()]
    const step = stepWith(declaration)

    expect(preserveCallerIntents(step, undefined, chain)).toBe(declaration)
  })

  it('returns an empty array unchanged when the step never had a caller intent', () => {
    const answer: TypedData[] = []

    expect(preserveCallerIntents(stepWith(), answer, chain)).toBe(answer)
    expect(
      preserveCallerIntents(stepWith([nativePermit()]), answer, chain)
    ).toBe(answer)
  })

  it('clears a relayer step completely, caller intent included', () => {
    const step = stepWith([witness(), callerIntent()])

    expect(preserveCallerIntents(step, [], chain)).toHaveLength(0)
  })

  it('appends only the caller intent, not the rest of the previous typed data', () => {
    const step = stepWith([nativePermit(), callerIntent()])

    const result = preserveCallerIntents(step, [], chain)

    expect(result?.map((typedData) => typedData.primaryType)).toEqual([
      'PermitSingle',
    ])
  })

  it('keeps the caller intent beside a native permit the API added', () => {
    const step = stepWith([callerIntent()])

    const result = preserveCallerIntents(step, [nativePermit()], chain)

    expect(result?.map((typedData) => typedData.primaryType)).toEqual([
      'Permit',
      'PermitSingle',
    ])
  })
})
