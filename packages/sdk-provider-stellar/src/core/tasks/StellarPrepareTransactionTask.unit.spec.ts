import type { TaskResult } from '@lifi/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StellarStepExecutorContext } from '../../types.js'
import type { assertApprovalStillCovers as AssertApprovalStillCovers } from './helpers/assertApprovalStillCovers.js'

// Typed from the real signatures the stubs stand in for, so that
// `toHaveBeenCalledWith` below is checked against the arguments those
// functions actually take, and the mocked `TaskResult` against its real shape.
const baseRun = vi.fn<
  (context: StellarStepExecutorContext) => Promise<TaskResult>
>(async () => ({ status: 'COMPLETED' }))

// Stub the base class so this suite tests the override, not the shared task.
// `PrepareTransactionTask.unit.spec.ts` in @lifi/sdk covers the base body — a
// mock of the @lifi/sdk package surface cannot reach the base task's own
// internal imports, because the provider resolves @lifi/sdk to its dist build.
vi.mock('@lifi/sdk', async () => {
  const actual = await vi.importActual<typeof import('@lifi/sdk')>('@lifi/sdk')
  class PrepareTransactionTask {
    protected shouldRefetchTransaction(
      _context: StellarStepExecutorContext
    ): boolean {
      return false
    }
    async run(context: StellarStepExecutorContext): Promise<TaskResult> {
      return baseRun(context)
    }
  }
  return { ...actual, PrepareTransactionTask }
})

const assertApprovalStillCovers = vi.fn<typeof AssertApprovalStillCovers>(
  async () => undefined
)
vi.mock('./helpers/assertApprovalStillCovers.js', () => ({
  assertApprovalStillCovers: (
    ...args: Parameters<typeof AssertApprovalStillCovers>
  ) => assertApprovalStillCovers(...args),
}))

const { StellarPrepareTransactionTask } = await import(
  './StellarPrepareTransactionTask.js'
)

const refetchDecision = (task: object): boolean =>
  (
    task as unknown as {
      shouldRefetchTransaction: (context: unknown) => boolean
    }
  ).shouldRefetchTransaction({ step: { transactionRequest: { data: 'x' } } })

describe('StellarPrepareTransactionTask', () => {
  beforeEach(() => {
    baseRun.mockClear()
    assertApprovalStillCovers.mockClear()
  })

  // The whole reason this subclass exists. A Stellar envelope embeds the
  // sender's sequence number and short timebounds, so reusing one is never
  // correct — not even when the step already carries it.
  it('always asks the base task to re-fetch', () => {
    expect(refetchDecision(new StellarPrepareTransactionTask())).toBe(true)
  })

  it('returns what the base task returns', async () => {
    const context = { step: {} } as never

    const result = await new StellarPrepareTransactionTask().run(context)

    expect(baseRun).toHaveBeenCalledWith(context)
    expect(result).toEqual({ status: 'COMPLETED' })
  })

  // The refresh happens inside the base task, so the granted allowance can only
  // be re-validated after it returns — and before the signing task runs.
  it('re-checks the granted allowance after the base task refreshes', async () => {
    const order: string[] = []
    baseRun.mockImplementation(async () => {
      order.push('refresh')
      return { status: 'COMPLETED' }
    })
    assertApprovalStillCovers.mockImplementation(async () => {
      order.push('assert')
      return undefined
    })
    const context = { step: {} } as never

    await new StellarPrepareTransactionTask().run(context)

    expect(order).toEqual(['refresh', 'assert'])
    expect(assertApprovalStillCovers).toHaveBeenCalledWith(context)
  })
})
