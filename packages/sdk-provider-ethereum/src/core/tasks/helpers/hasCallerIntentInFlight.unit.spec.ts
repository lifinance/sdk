import type { SignedTypedData, TypedData } from '@lifi/sdk'
import type { Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import type { EthereumStepExecutorContext } from '../../../types.js'
import { hasCallerIntentInFlight } from './hasCallerIntentInFlight.js'

const SOURCE_CHAIN = 1
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const UNIVERSAL_ROUTER = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af'
const SIGNATURE = `0x${'11'.repeat(65)}` as Hex

const callerIntent = (): TypedData =>
  ({
    primaryType: 'PermitSingle',
    domain: { chainId: SOURCE_CHAIN, verifyingContract: PERMIT2 },
    types: {},
    message: { spender: UNIVERSAL_ROUTER },
  }) as unknown as TypedData

const signedCallerIntent = (): SignedTypedData =>
  ({ ...callerIntent(), signature: SIGNATURE }) as unknown as SignedTypedData

const witness = (): TypedData =>
  ({
    primaryType: 'PermitWitnessTransferFrom',
    domain: { chainId: SOURCE_CHAIN, verifyingContract: PERMIT2 },
    types: {},
    message: {},
  }) as unknown as TypedData

const buildContext = (
  stepTypedData: TypedData[],
  signedTypedData: SignedTypedData[] = []
): EthereumStepExecutorContext =>
  ({
    step: {
      action: { fromChainId: SOURCE_CHAIN },
      estimate: { approvalAddress: PERMIT2 },
      typedData: stepTypedData,
    },
    fromChain: { id: SOURCE_CHAIN, permit2: PERMIT2 },
    signedTypedData,
  }) as unknown as EthereumStepExecutorContext

describe('hasCallerIntentInFlight', () => {
  it('is true from the declaration alone', () => {
    expect(hasCallerIntentInFlight(buildContext([callerIntent()], []))).toBe(
      true
    )
  })

  it('is true from the signed record alone', () => {
    expect(
      hasCallerIntentInFlight(buildContext([], [signedCallerIntent()]))
    ).toBe(true)
  })

  it('is true when both sources carry the intent', () => {
    expect(
      hasCallerIntentInFlight(
        buildContext([callerIntent()], [signedCallerIntent()])
      )
    ).toBe(true)
  })

  it('is false when neither source carries a caller intent', () => {
    expect(hasCallerIntentInFlight(buildContext([witness()], []))).toBe(false)
    expect(hasCallerIntentInFlight(buildContext([], []))).toBe(false)
  })
})
