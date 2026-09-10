import type { ExtendedChain, LiFiStep } from '@lifi/sdk'
import { describe, expect, it } from 'vitest'
import { MaxUint256 } from '../../../permits/constants.js'
import type { EthereumStepExecutorContext } from '../../../types.js'
import { getApprovalAmount } from './getApprovalAmount.js'

const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const OTHER_PERMIT2 = '0x0000000000000000000000000000000000009999'
const UNIVERSAL_ROUTER = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af'
const FROM_AMOUNT = '1000000'

const permitSingle = (verifyingContract: string) => ({
  primaryType: 'PermitSingle',
  domain: { chainId: 1, verifyingContract },
  types: {},
  message: { spender: UNIVERSAL_ROUTER },
})

const buildContext = (options?: {
  approvalAddress?: string
  typedData?: unknown[]
  disableMessageSigning?: boolean
}): EthereumStepExecutorContext =>
  ({
    step: {
      action: { fromChainId: 1, fromAmount: FROM_AMOUNT },
      estimate: {
        approvalAddress: options?.approvalAddress ?? PERMIT2,
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

  it('approves MAX when the approval target is the Permit2 the intent names', () => {
    // The unlimited approval can only land on the contract written inside the
    // message the user signs, so repeat swaps become signature-only.
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

  it('requires EVERY caller intent to name the approval target', () => {
    // One agreeing intent must not buy an unlimited approval for a step that
    // also carries an intent naming a different Permit2 deployment.
    const context = buildContext({
      approvalAddress: PERMIT2,
      typedData: [permitSingle(PERMIT2), permitSingle(OTHER_PERMIT2)],
    })
    expect(getApprovalAmount(context, false)).toBe(BigInt(FROM_AMOUNT))
  })

  it('returns the swap amount when message signing is disabled, because the intent is never signed', () => {
    // `EthereumSignStepIntentTask.shouldRun` drops the intent for the same
    // flag, so the user is never shown the message. Granting MaxUint256 for a
    // contract nobody agreed to voids the self-validating argument.
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
      typedData: [{ primaryType: 'Order', domain: {}, types: {}, message: {} }],
    })
    expect(getApprovalAmount(context, false)).toBe(BigInt(FROM_AMOUNT))
  })
})
