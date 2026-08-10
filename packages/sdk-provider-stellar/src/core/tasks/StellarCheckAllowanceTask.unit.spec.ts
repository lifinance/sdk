import { StrKey } from '@stellar/stellar-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const readAllowance = vi.fn()
vi.mock('./helpers/readAllowance.js', () => ({
  readAllowance: (...args: unknown[]) => readAllowance(...args),
}))

const { StellarCheckAllowanceTask } = await import(
  './StellarCheckAllowanceTask.js'
)

const ROUTER = StrKey.encodeContract(Buffer.alloc(32, 3))
const CIRCLE_ADAPTER = StrKey.encodeContract(Buffer.alloc(32, 7))
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 4))
const INTERMEDIATE_TOKEN = StrKey.encodeContract(Buffer.alloc(32, 5))
const WALLET = 'GCEYC5WE3ZAVEWC2SCRL2HSOEOVWGEDNPKKGV3ABSRWAIBXH4GJ7DASG'
const PASSPHRASE = 'Test SDF Network ; September 2015'

const cctpLeg = (fromAmount: string, tokenAddress = TOKEN) => ({
  action: { fromToken: { address: tokenAddress } },
  estimate: {
    fromAmount,
    approvalAddress: CIRCLE_ADAPTER,
    skipApproval: false,
  },
})

const skippingLeg = {
  action: { fromToken: { address: TOKEN } },
  estimate: { fromAmount: '1000', approvalAddress: ROUTER, skipApproval: true },
}

const stepWith = (includedSteps: unknown[]) => ({
  action: {
    fromChainId: 1500,
    fromAmount: '1000',
    fromToken: { address: TOKEN },
  },
  // The route-level summary must never drive the decision.
  estimate: { approvalAddress: ROUTER },
  includedSteps,
})

const context = (overrides: Record<string, unknown> = {}) =>
  ({
    client: {},
    wallet: { address: WALLET },
    networkPassphrase: PASSPHRASE,
    step: stepWith([cctpLeg('1000')]),
    statusManager: {
      initializeAction: () => ({ type: 'CHECK_ALLOWANCE' }),
      updateAction: () => {},
    },
    ...overrides,
  }) as never

describe('StellarCheckAllowanceTask', () => {
  beforeEach(() => {
    readAllowance.mockReset()
  })

  it('reports sufficient allowance when it covers the approving leg', async () => {
    readAllowance.mockResolvedValue(1100n)

    const result = await new StellarCheckAllowanceTask().run(context())

    expect(result.context).toEqual({
      approval: {
        spender: CIRCLE_ADAPTER,
        tokenAddress: TOKEN,
        // The leg's 1000 plus the 10% head-room.
        amount: 1100n,
      },
      hasSufficientAllowance: true,
    })
  })

  it('reports insufficient allowance when it is short of the buffered amount', async () => {
    // Covers the leg's raw fromAmount but not the head-room on top of it.
    readAllowance.mockResolvedValue(1099n)

    const result = await new StellarCheckAllowanceTask().run(context())

    expect(result.context).toMatchObject({ hasSufficientAllowance: false })
  })

  it('reads the allowance for the approving leg, not the route source token', async () => {
    readAllowance.mockResolvedValue(1000n)

    // swap → CCTP: the allowance is on the intermediate token the swap produces.
    await new StellarCheckAllowanceTask().run(
      context({
        step: stepWith([skippingLeg, cctpLeg('990', INTERMEDIATE_TOKEN)]),
      })
    )

    expect(readAllowance).toHaveBeenCalledWith(
      {},
      INTERMEDIATE_TOKEN,
      WALLET,
      CIRCLE_ADAPTER,
      PASSPHRASE
    )
  })

  it('skips the allowance read entirely when every leg skips one', async () => {
    const result = await new StellarCheckAllowanceTask().run(
      context({ step: stepWith([skippingLeg]) })
    )

    expect(readAllowance).not.toHaveBeenCalled()
    expect(result.context).toEqual({
      approval: undefined,
      hasSufficientAllowance: true,
    })
  })

  it('ignores the route-level approvalAddress when every leg skips one', async () => {
    // A swap-only route summarises approvalAddress as the router — a valid
    // C-address that nothing ever charges.
    const result = await new StellarCheckAllowanceTask().run(
      context({
        step: {
          ...stepWith([skippingLeg]),
          estimate: { approvalAddress: ROUTER, skipApproval: true },
        },
      })
    )

    expect(readAllowance).not.toHaveBeenCalled()
    expect(result.context).toMatchObject({ approval: undefined })
  })
})
