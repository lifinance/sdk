import type { Address } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../permits/canAccountUsePermit2.js', () => ({
  canAccountUsePermit2: vi.fn(),
}))

import { canAccountUsePermit2 } from '../../../permits/canAccountUsePermit2.js'
import type { EthereumStepExecutorContext } from '../../../types.js'
import { isAllowancePreparedForAnotherStrategy } from './isAllowancePreparedForAnotherStrategy.js'

const OWNER = '0xaaaa000000000000000000000000000000000001' as Address
const TOKEN = '0xcccc000000000000000000000000000000000003' as Address
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address
const APPROVAL_ADDRESS = '0x2222222222222222222222222222222222222222' as Address

const QUEUED_APPROVE = { to: TOKEN, data: '0x095ea7b3' as const, chainId: 1 }

/** A step on a Permit2 chain, so the spender depends on the strategy. */
const buildContext = (
  overrides: Partial<EthereumStepExecutorContext> = {}
): EthereumStepExecutorContext =>
  ({
    client: {},
    ethereumClient: { account: { address: OWNER } },
    isFromNativeToken: false,
    disableMessageSigning: false,
    signedTypedData: [],
    calls: [],
    fromChain: {
      id: 1,
      permit2: PERMIT2,
      permit2Proxy: '0x1111111111111111111111111111111111111111',
    },
    step: {
      action: { fromAddress: OWNER },
      estimate: { approvalAddress: APPROVAL_ADDRESS },
    },
    ...overrides,
  }) as unknown as EthereumStepExecutorContext

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(canAccountUsePermit2).mockResolvedValue(true)
})

describe('isAllowancePreparedForAnotherStrategy', () => {
  it('holds when the strategy did not change', async () => {
    const context = buildContext({ calls: [QUEUED_APPROVE] })

    expect(
      await isAllowancePreparedForAnotherStrategy(context, 'batched', 'batched')
    ).toBe(false)
  })

  it('fails when calls were queued for a batch that will not be sent', async () => {
    const context = buildContext({
      calls: [QUEUED_APPROVE],
      disableMessageSigning: true,
      allowanceSpender: APPROVAL_ADDRESS,
    })

    expect(
      await isAllowancePreparedForAnotherStrategy(context, 'batched', 'relayed')
    ).toBe(true)
  })

  it('fails when nothing was queued but the new strategy needs another spender', async () => {
    // JUMEMB-102 symptom B: an allowance to `approvalAddress` queued nothing,
    // but the relayed lane pulls through Permit2.
    const context = buildContext({ allowanceSpender: APPROVAL_ADDRESS })

    expect(
      await isAllowancePreparedForAnotherStrategy(context, 'batched', 'relayed')
    ).toBe(true)
  })

  it('holds when nothing was queued and the spender is the same', async () => {
    const context = buildContext({
      disableMessageSigning: true,
      allowanceSpender: APPROVAL_ADDRESS,
    })

    expect(
      await isAllowancePreparedForAnotherStrategy(context, 'batched', 'relayed')
    ).toBe(false)
  })

  it('compares addresses regardless of case', async () => {
    const context = buildContext({
      allowanceSpender: PERMIT2.toLowerCase() as Address,
    })

    expect(
      await isAllowancePreparedForAnotherStrategy(
        context,
        'standard',
        'relayed'
      )
    ).toBe(false)
  })

  it('compares the recorded spender, not one derived again from the re-quoted step', async () => {
    // `relayed` checked Permit2; the batch pulls through `approvalAddress`.
    const context = buildContext({ allowanceSpender: PERMIT2 })

    expect(
      await isAllowancePreparedForAnotherStrategy(context, 'relayed', 'batched')
    ).toBe(true)
  })

  it('reports a standard signer that failed the Permit2 probe', async () => {
    // The helper reports the mismatch; prepare decides not to replay after
    // `standard`.
    vi.mocked(canAccountUsePermit2).mockResolvedValue(false)
    const context = buildContext({ allowanceSpender: APPROVAL_ADDRESS })

    expect(
      await isAllowancePreparedForAnotherStrategy(
        context,
        'standard',
        'relayed'
      )
    ).toBe(true)
  })

  it('holds when a signed native permit covers the allowance', async () => {
    const context = buildContext({
      allowanceSpender: APPROVAL_ADDRESS,
      hasMatchingPermit: true,
    })

    expect(
      await isAllowancePreparedForAnotherStrategy(
        context,
        'standard',
        'relayed'
      )
    ).toBe(false)
  })

  it('holds when no allowance was checked', async () => {
    expect(
      await isAllowancePreparedForAnotherStrategy(
        buildContext(),
        'batched',
        'relayed'
      )
    ).toBe(false)
  })
})
