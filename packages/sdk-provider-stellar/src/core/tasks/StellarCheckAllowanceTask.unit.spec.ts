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
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 4))
const WALLET = 'GCEYC5WE3ZAVEWC2SCRL2HSOEOVWGEDNPKKGV3ABSRWAIBXH4GJ7DASG'

const context = (overrides: Record<string, unknown> = {}) =>
  ({
    client: {},
    wallet: { address: WALLET },
    networkPassphrase: 'Test SDF Network ; September 2015',
    step: {
      action: {
        fromChainId: 1500,
        fromAmount: '1000',
        fromToken: { address: TOKEN },
      },
      estimate: { approvalAddress: ROUTER },
    },
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

  it('reports sufficient allowance when it covers fromAmount', async () => {
    readAllowance.mockResolvedValue(1000n)

    const result = await new StellarCheckAllowanceTask().run(context())

    expect(result.context).toEqual({
      approvalSpender: ROUTER,
      hasSufficientAllowance: true,
    })
  })

  it('reports insufficient allowance when it is short', async () => {
    readAllowance.mockResolvedValue(999n)

    const result = await new StellarCheckAllowanceTask().run(context())

    expect(result.context).toEqual({
      approvalSpender: ROUTER,
      hasSufficientAllowance: false,
    })
  })

  it('skips the allowance read entirely when no spender resolves', async () => {
    const result = await new StellarCheckAllowanceTask().run(
      context({
        step: {
          action: {
            fromChainId: 1500,
            fromAmount: '1000',
            fromToken: { address: TOKEN },
          },
          // the placeholder the backend currently sends for polymer/nearIntents
          estimate: {
            approvalAddress: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',
          },
        },
      })
    )

    expect(readAllowance).not.toHaveBeenCalled()
    expect(result.context).toEqual({
      approvalSpender: undefined,
      hasSufficientAllowance: true,
    })
  })

  it('compares against the post-CheckBalance fromAmount, not the original quote', async () => {
    readAllowance.mockResolvedValue(500n)

    // CheckBalanceTask's slippage rescue can revise fromAmount downward; the
    // allowance must be judged against the revised value.
    const result = await new StellarCheckAllowanceTask().run(
      context({
        step: {
          action: {
            fromChainId: 1500,
            fromAmount: '500',
            fromToken: { address: TOKEN },
          },
          estimate: { approvalAddress: ROUTER },
        },
      })
    )

    expect(result.context).toMatchObject({ hasSufficientAllowance: true })
  })

  it('honours the provider override when the estimate has a placeholder', async () => {
    readAllowance.mockResolvedValue(1000n)

    await new StellarCheckAllowanceTask().run(
      context({
        approvalSpenderOverride: ROUTER,
        step: {
          action: {
            fromChainId: 1500,
            fromAmount: '1000',
            fromToken: { address: TOKEN },
          },
          estimate: { approvalAddress: '' },
        },
      })
    )

    expect(readAllowance).toHaveBeenCalledWith(
      {},
      TOKEN,
      WALLET,
      ROUTER,
      'Test SDF Network ; September 2015'
    )
  })
})
