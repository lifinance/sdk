import type { SignedTypedData, TypedData } from '@lifi/sdk'
import type { Address, Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import type { EthereumStepExecutorContext } from '../../../types.js'
import { findSignedNativePermit } from './findSignedNativePermit.js'

const SOURCE_CHAIN = 1
const OTHER_CHAIN = 137
const FROM_ADDRESS = '0xaaaa000000000000000000000000000000000001' as Address
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const PERMIT2_PROXY = '0xbbbb000000000000000000000000000000000002'
const UNIVERSAL_ROUTER = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af'
const SIGNATURE = `0x${'11'.repeat(65)}` as Hex

const signedNativePermit = (options?: {
  chainId?: number
  signature?: Hex
}): SignedTypedData =>
  ({
    primaryType: 'Permit',
    domain: { chainId: options?.chainId ?? SOURCE_CHAIN },
    types: {},
    message: {
      owner: FROM_ADDRESS,
      spender: PERMIT2_PROXY,
      value: '1000000',
      nonce: '0',
      deadline: String(Math.floor(Date.now() / 1000) + 3600),
    },
    signature: options?.signature ?? SIGNATURE,
  }) as unknown as SignedTypedData

const signedCallerIntent = (): SignedTypedData =>
  ({
    primaryType: 'PermitSingle',
    domain: { chainId: SOURCE_CHAIN, verifyingContract: PERMIT2 },
    types: {},
    message: { spender: UNIVERSAL_ROUTER },
    signature: SIGNATURE,
  }) as unknown as SignedTypedData

const callerIntent = (): TypedData =>
  ({
    primaryType: 'PermitSingle',
    domain: { chainId: SOURCE_CHAIN, verifyingContract: PERMIT2 },
    types: {},
    message: { spender: UNIVERSAL_ROUTER },
  }) as unknown as TypedData

const buildContext = (
  signedTypedData: SignedTypedData[],
  stepTypedData?: TypedData[]
): EthereumStepExecutorContext =>
  ({
    step: {
      type: 'lifi',
      id: 'step-1',
      action: { fromChainId: SOURCE_CHAIN, fromAddress: FROM_ADDRESS },
      estimate: { approvalAddress: PERMIT2 },
      ...(stepTypedData ? { typedData: stepTypedData } : {}),
    },
    fromChain: { id: SOURCE_CHAIN, permit2: PERMIT2 },
    signedTypedData,
  }) as unknown as EthereumStepExecutorContext

describe('findSignedNativePermit', () => {
  it('returns the signed native permit for a native-permit-only step', () => {
    const permit = signedNativePermit()

    expect(findSignedNativePermit(buildContext([permit]))).toBe(permit)
  })

  it('returns undefined for a caller intent, even with a native permit signed', () => {
    const context = buildContext(
      [signedNativePermit(), signedCallerIntent()],
      [callerIntent()]
    )

    expect(findSignedNativePermit(context)).toBeUndefined()
  })

  it('returns undefined when the API erased the declaration and only the signed record shows the intent', () => {
    const context = buildContext(
      [signedNativePermit(), signedCallerIntent()],
      []
    )

    expect(findSignedNativePermit(context)).toBeUndefined()
  })

  it('returns undefined when no native permit is signed', () => {
    expect(findSignedNativePermit(buildContext([]))).toBeUndefined()
  })

  it('ignores a native permit signed for a different chain', () => {
    const context = buildContext([signedNativePermit({ chainId: OTHER_CHAIN })])

    expect(findSignedNativePermit(context)).toBeUndefined()
  })

  it('ignores a native permit carrying an invalid signature', () => {
    const context = buildContext([signedNativePermit({ signature: '0x' })])

    expect(findSignedNativePermit(context)).toBeUndefined()
  })
})
