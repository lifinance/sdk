import { StrKey } from '@stellar/stellar-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const buildApproveTransaction = vi.fn()
vi.mock('./helpers/buildApproveTransaction.js', () => ({
  buildApproveTransaction: (...args: unknown[]) =>
    buildApproveTransaction(...args),
}))

const submitStellarTransaction = vi.fn()
const waitForStellarTransaction = vi.fn()
vi.mock('./helpers/submitStellarTransaction.js', () => ({
  submitStellarTransaction: (...args: unknown[]) =>
    submitStellarTransaction(...args),
  waitForStellarTransaction: (...args: unknown[]) =>
    waitForStellarTransaction(...args),
}))

const { StellarSetAllowanceTask } = await import('./StellarSetAllowanceTask.js')

const ROUTER = StrKey.encodeContract(Buffer.alloc(32, 3))
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 4))
const WALLET = 'GCEYC5WE3ZAVEWC2SCRL2HSOEOVWGEDNPKKGV3ABSRWAIBXH4GJ7DASG'

const makeContext = (overrides: Record<string, unknown> = {}) => {
  const updateAction = vi.fn()
  const signTransaction = vi.fn().mockResolvedValue({ signedTxXdr: 'SIGNED' })
  return {
    updateAction,
    signTransaction,
    context: {
      client: {},
      wallet: { address: WALLET, signTransaction },
      fromChain: { metamask: { blockExplorerUrls: ['https://explorer/'] } },
      networkPassphrase: 'Test SDF Network ; September 2015',
      approvalSpender: ROUTER,
      allowUserInteraction: true,
      checkWallet: () => {},
      step: {
        action: {
          fromChainId: 1500,
          fromAmount: '1000',
          fromToken: { address: TOKEN },
        },
        estimate: { approvalAddress: ROUTER },
      },
      statusManager: {
        initializeAction: () => ({ type: 'SET_ALLOWANCE' }),
        updateAction,
      },
      ...overrides,
    } as never,
  }
}

describe('StellarSetAllowanceTask', () => {
  beforeEach(() => {
    buildApproveTransaction.mockReset().mockResolvedValue('UNSIGNED')
    submitStellarTransaction.mockReset().mockResolvedValue('approve-hash')
    waitForStellarTransaction.mockReset().mockResolvedValue({})
  })

  describe('shouldRun', () => {
    it('runs when a spender resolved and the allowance is short', async () => {
      const task = new StellarSetAllowanceTask()
      await expect(
        task.shouldRun({
          approvalSpender: ROUTER,
          hasSufficientAllowance: false,
        } as never)
      ).resolves.toBe(true)
    })

    it('skips when the allowance already suffices', async () => {
      const task = new StellarSetAllowanceTask()
      await expect(
        task.shouldRun({
          approvalSpender: ROUTER,
          hasSufficientAllowance: true,
        } as never)
      ).resolves.toBe(false)
    })

    it('skips when no spender resolved', async () => {
      const task = new StellarSetAllowanceTask()
      await expect(
        task.shouldRun({
          approvalSpender: undefined,
          hasSufficientAllowance: false,
        } as never)
      ).resolves.toBe(false)
    })
  })

  it('approves exactly fromAmount, then waits for on-chain confirmation', async () => {
    const { context } = makeContext()

    const result = await new StellarSetAllowanceTask().run(context)

    expect(buildApproveTransaction).toHaveBeenCalledWith(
      {},
      TOKEN,
      WALLET,
      ROUTER,
      1000n,
      'Test SDF Network ; September 2015'
    )
    // Confirmation is mandatory: the backend reads the account sequence live, so
    // an unconfirmed approval would yield an envelope with a stale sequence.
    expect(waitForStellarTransaction).toHaveBeenCalledWith(
      {},
      'approve-hash',
      undefined
    )
    expect(result).toEqual({
      status: 'COMPLETED',
      context: { hasSufficientAllowance: true },
    })
  })

  it('confirms only after submitting', async () => {
    const order: string[] = []
    submitStellarTransaction.mockImplementation(async () => {
      order.push('submit')
      return 'approve-hash'
    })
    waitForStellarTransaction.mockImplementation(async () => {
      order.push('wait')
    })

    await new StellarSetAllowanceTask().run(makeContext().context)

    expect(order).toEqual(['submit', 'wait'])
  })

  it('pauses without prompting when interaction is disallowed', async () => {
    const { context, signTransaction } = makeContext({
      allowUserInteraction: false,
    })

    const result = await new StellarSetAllowanceTask().run(context)

    expect(result).toEqual({ status: 'PAUSED' })
    expect(signTransaction).not.toHaveBeenCalled()
    expect(buildApproveTransaction).not.toHaveBeenCalled()
  })

  it('clears a previous attempt txHash before prompting again', async () => {
    const { context, updateAction } = makeContext()

    await new StellarSetAllowanceTask().run(context)

    expect(updateAction).toHaveBeenCalledWith(
      context.step,
      'SET_ALLOWANCE',
      'ACTION_REQUIRED',
      { txHash: undefined, txLink: undefined }
    )
  })

  it('marks the action DONE with the approval hash and link', async () => {
    const { context, updateAction } = makeContext()

    await new StellarSetAllowanceTask().run(context)

    expect(updateAction).toHaveBeenLastCalledWith(
      context.step,
      'SET_ALLOWANCE',
      'DONE',
      {
        txHash: 'approve-hash',
        txLink: 'https://explorer/tx/approve-hash',
      }
    )
  })
})
