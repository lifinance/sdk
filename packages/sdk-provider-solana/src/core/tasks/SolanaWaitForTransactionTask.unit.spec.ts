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

  it('routes to the standard task when the flag is absent', async () => {
    const context = {} as never
    await new SolanaWaitForTransactionTask().run(context)

    expect(standardRun).toHaveBeenCalledWith(context)
    expect(jitoRun).not.toHaveBeenCalled()
  })
})
