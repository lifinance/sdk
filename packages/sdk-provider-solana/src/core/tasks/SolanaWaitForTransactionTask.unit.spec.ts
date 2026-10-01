import { beforeEach, describe, expect, it, vi } from 'vitest'

const jitoRun = vi.fn()
const standardRun = vi.fn()

vi.mock('./SolanaJitoWaitForTransactionTask.js', () => ({
  SolanaJitoWaitForTransactionTask: class {
    run(...args: unknown[]) {
      return jitoRun(...args)
    }
  },
}))

vi.mock('./SolanaStandardWaitForTransactionTask.js', () => ({
  SolanaStandardWaitForTransactionTask: class {
    run(...args: unknown[]) {
      return standardRun(...args)
    }
  },
}))

const { SolanaWaitForTransactionTask } = await import(
  './SolanaWaitForTransactionTask.js'
)

/** A resumed context: the sign task did not run, so there is no flag. */
const resumeContext = (action: object, isBridgeExecution = false) => {
  const findAction = vi.fn((_step: unknown, type: string) => ({
    type,
    status: 'PENDING',
    ...action,
  }))
  return {
    findAction,
    context: {
      step: {},
      isBridgeExecution,
      statusManager: { findAction },
    } as never,
  }
}

describe('SolanaWaitForTransactionTask', () => {
  beforeEach(() => {
    jitoRun.mockReset().mockResolvedValue({ status: 'COMPLETED' })
    standardRun.mockReset().mockResolvedValue({ status: 'COMPLETED' })
  })

  it('routes to the Jito task when the data was a bundle (array)', async () => {
    const context = { isBundleExecution: true } as never
    await new SolanaWaitForTransactionTask().run(context)

    expect(jitoRun).toHaveBeenCalledWith(context)
    expect(standardRun).not.toHaveBeenCalled()
  })

  it('routes to the standard task when the data was a single transaction (string)', async () => {
    const context = { isBundleExecution: false } as never
    await new SolanaWaitForTransactionTask().run(context)

    expect(standardRun).toHaveBeenCalledWith(context)
    expect(jitoRun).not.toHaveBeenCalled()
  })

  it('routes a resume with only a txHash to the standard task', async () => {
    // The hash lookup works for a bundle's first signature too.
    const { context } = resumeContext({ txHash: 'sig' })

    await new SolanaWaitForTransactionTask().run(context)

    expect(standardRun).toHaveBeenCalledWith(context)
    expect(jitoRun).not.toHaveBeenCalled()
  })

  it('routes a resume to the Jito task when txHex holds a bundle', async () => {
    const { context, findAction } = resumeContext({ txHex: '["AA==","AQ=="]' })

    await new SolanaWaitForTransactionTask().run(context)

    expect(findAction).toHaveBeenCalledWith(expect.anything(), 'SWAP')
    expect(jitoRun).toHaveBeenCalledWith(context)
    expect(standardRun).not.toHaveBeenCalled()
  })

  it('keeps a one-element bundle on the Jito task', async () => {
    // Sent through `sendTransaction`, a bundle transaction would skip the
    // Jito tip auction it was built for.
    const { context } = resumeContext({ txHex: '["AA=="]' })

    await new SolanaWaitForTransactionTask().run(context)

    expect(jitoRun).toHaveBeenCalledWith(context)
  })

  it('routes a resume to the standard task when txHex holds a single transaction', async () => {
    const { context } = resumeContext({ txHex: 'AA==' })

    await new SolanaWaitForTransactionTask().run(context)

    expect(standardRun).toHaveBeenCalledWith(context)
    expect(jitoRun).not.toHaveBeenCalled()
  })

  it('reads the CROSS_CHAIN action of a bridge', async () => {
    const { context, findAction } = resumeContext({ txHex: '["AA=="]' }, true)

    await new SolanaWaitForTransactionTask().run(context)

    expect(findAction).toHaveBeenCalledWith(expect.anything(), 'CROSS_CHAIN')
    expect(jitoRun).toHaveBeenCalledWith(context)
  })

  it('trusts the flag of the sign task on the first run', async () => {
    const findAction = vi.fn()
    const context = {
      isBundleExecution: false,
      statusManager: { findAction },
    } as never

    await new SolanaWaitForTransactionTask().run(context)

    expect(standardRun).toHaveBeenCalledWith(context)
    expect(findAction).not.toHaveBeenCalled()
  })
})
