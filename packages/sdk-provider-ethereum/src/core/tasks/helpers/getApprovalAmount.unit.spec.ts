import type { ExtendedChain, LiFiStep } from '@lifi/sdk'
import { describe, expect, it } from 'vitest'
import { MaxUint256 } from '../../../permits/constants.js'
import type { EthereumStepExecutorContext } from '../../../types.js'
import { getApprovalAmount, getRequiredAllowance } from './getApprovalAmount.js'

const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const OTHER_PERMIT2 = '0x0000000000000000000000000000000000009999'
const UNIVERSAL_ROUTER = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af'
const FROM_AMOUNT = '1000000'
const APPROVAL_AMOUNT = '3000000'

const permitSingle = (verifyingContract: string) => ({
  primaryType: 'PermitSingle',
  domain: { chainId: 1, verifyingContract },
  types: {},
  message: { spender: UNIVERSAL_ROUTER },
})

const buildContext = (options?: {
  approvalAddress?: string
  approvalAmount?: string
  typedData?: unknown[]
  disableMessageSigning?: boolean
}): EthereumStepExecutorContext =>
  ({
    step: {
      action: { fromChainId: 1, fromAmount: FROM_AMOUNT },
      estimate: {
        approvalAddress: options?.approvalAddress ?? PERMIT2,
        ...(options?.approvalAmount
          ? { approvalAmount: options.approvalAmount }
          : {}),
      },
      ...(options?.typedData ? { typedData: options.typedData } : {}),
    } as unknown as LiFiStep,
    fromChain: { id: 1, permit2: PERMIT2 } as unknown as ExtendedChain,
    disableMessageSigning: options?.disableMessageSigning ?? false,
  }) as unknown as EthereumStepExecutorContext

describe('getApprovalAmount', () => {
  it('approves MAX for the SDK own Permit2 flow, unchanged', () => {
    expect(getApprovalAmount(buildContext(), true)).toBe(MaxUint256)
  })

  it('approves the swap amount for a plain step', () => {
    expect(getApprovalAmount(buildContext(), false)).toBe(BigInt(FROM_AMOUNT))
  })

  it('approves MAX when the approval target is the Permit2 the allowance names', () => {
    const context = buildContext({
      approvalAddress: PERMIT2,
      typedData: [permitSingle(PERMIT2)],
    })
    expect(getApprovalAmount(context, false)).toBe(MaxUint256)
  })

  it('matches the address in any letter case', () => {
    const context = buildContext({
      approvalAddress: PERMIT2.toLowerCase(),
      typedData: [permitSingle(PERMIT2.toUpperCase())],
    })
    expect(getApprovalAmount(context, false)).toBe(MaxUint256)
  })

  it('falls back to the swap amount when the target and the message disagree', () => {
    const context = buildContext({
      approvalAddress: PERMIT2,
      typedData: [permitSingle(OTHER_PERMIT2)],
    })
    expect(getApprovalAmount(context, false)).toBe(BigInt(FROM_AMOUNT))
  })

  it('requires EVERY Permit2 allowance to name the approval target', () => {
    const context = buildContext({
      approvalAddress: PERMIT2,
      typedData: [permitSingle(PERMIT2), permitSingle(OTHER_PERMIT2)],
    })
    expect(getApprovalAmount(context, false)).toBe(BigInt(FROM_AMOUNT))
  })

  it('returns the swap amount when message signing is disabled, because the allowance is never signed', () => {
    const context = buildContext({
      approvalAddress: PERMIT2,
      typedData: [permitSingle(PERMIT2)],
      disableMessageSigning: true,
    })
    expect(getApprovalAmount(context, false)).toBe(BigInt(FROM_AMOUNT))
  })

  it('ignores the relayer lane when deciding', () => {
    const context = buildContext({
      approvalAddress: PERMIT2,
      typedData: [
        {
          primaryType: 'Order',
          domain: { chainId: 1, verifyingContract: PERMIT2 },
          types: {},
          message: {},
        },
      ],
    })
    expect(getApprovalAmount(context, false)).toBe(BigInt(FROM_AMOUNT))
  })

  it('approves the estimate approvalAmount when the backend sets one', () => {
    const context = buildContext({ approvalAmount: APPROVAL_AMOUNT })
    expect(getApprovalAmount(context, false)).toBe(BigInt(APPROVAL_AMOUNT))
  })

  it('approves MAX to the Permit2 the allowance names, even with an approvalAmount', () => {
    const context = buildContext({
      approvalAddress: PERMIT2,
      approvalAmount: APPROVAL_AMOUNT,
      typedData: [permitSingle(PERMIT2)],
    })
    expect(getApprovalAmount(context, false)).toBe(MaxUint256)
  })

  it('never approves less than the swap amount', () => {
    for (const approvalAmount of ['0', '1']) {
      const context = buildContext({ approvalAmount })
      expect(getApprovalAmount(context, false)).toBe(BigInt(FROM_AMOUNT))
    }
  })

  it('keeps MAX for the SDK own Permit2 flow even with an approvalAmount', () => {
    const context = buildContext({ approvalAmount: APPROVAL_AMOUNT })
    expect(getApprovalAmount(context, true)).toBe(MaxUint256)
  })
})

describe('getRequiredAllowance', () => {
  it('requires the swap amount by default', () => {
    expect(getRequiredAllowance(buildContext(), false)).toBe(
      BigInt(FROM_AMOUNT)
    )
  })

  it('requires the estimate approvalAmount on the approval address', () => {
    const context = buildContext({ approvalAmount: APPROVAL_AMOUNT })
    expect(getRequiredAllowance(context, false)).toBe(BigInt(APPROVAL_AMOUNT))
  })

  it('requires the swap amount on Permit2, whose spender is not the approval address', () => {
    const context = buildContext({ approvalAmount: APPROVAL_AMOUNT })
    expect(getRequiredAllowance(context, true)).toBe(BigInt(FROM_AMOUNT))
  })

  it('requires the swap amount when the approval target is the Permit2 the allowance names', () => {
    const context = buildContext({
      approvalAddress: PERMIT2,
      approvalAmount: APPROVAL_AMOUNT,
      typedData: [permitSingle(PERMIT2)],
    })
    expect(getRequiredAllowance(context, false)).toBe(BigInt(FROM_AMOUNT))
  })

  it('never requires less than the swap amount', () => {
    for (const approvalAmount of ['0', '1']) {
      const context = buildContext({ approvalAmount })
      expect(getRequiredAllowance(context, false)).toBe(BigInt(FROM_AMOUNT))
    }
  })

  it('treats an allowance of 2^96 - 1 as enough for an unlimited approvalAmount', () => {
    const context = buildContext({ approvalAmount: MaxUint256.toString() })
    expect(getRequiredAllowance(context, false)).toBe(2n ** 96n - 1n)
  })
})
