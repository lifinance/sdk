import type {
  ExecutionAction,
  LiFiStepExtended,
  StatusManager,
  TransactionMethodType,
} from '@lifi/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const lanes = vi.hoisted(() => ({
  standard: vi.fn(async () => ({ status: 'COMPLETED' as const })),
  batched: vi.fn(async () => ({ status: 'COMPLETED' as const })),
  relayed: vi.fn(async () => ({ status: 'COMPLETED' as const })),
}))

vi.mock('./EthereumStandardWaitForTransactionTask.js', () => ({
  EthereumStandardWaitForTransactionTask: class {
    run = lanes.standard
  },
}))
vi.mock('./EthereumBatchedWaitForTransactionTask.js', () => ({
  EthereumBatchedWaitForTransactionTask: class {
    run = lanes.batched
  },
}))
vi.mock('./EthereumRelayedWaitForTransactionTask.js', () => ({
  EthereumRelayedWaitForTransactionTask: class {
    run = lanes.relayed
  },
}))
vi.mock('./helpers/getEthereumExecutionStrategy.js', () => ({
  getEthereumExecutionStrategy: vi.fn(),
}))

import type { EthereumStepExecutorContext } from '../../types.js'
import { EthereumWaitForTransactionTask } from './EthereumWaitForTransactionTask.js'
import { getEthereumExecutionStrategy } from './helpers/getEthereumExecutionStrategy.js'

// The wait lane of an open transaction is the lane that sent it, as the sign
// task stored it in `txType`. The step content decides only when there is no
// stored lane: a route stored without `txType`, or an action whose `txType`
// belongs to no open transaction.

/** A bridge keeps its transaction on CROSS_CHAIN, a swap on SWAP. */
const buildContext = (
  action: Partial<ExecutionAction>,
  isBridgeExecution: boolean
): EthereumStepExecutorContext => {
  const actionType = isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
  return {
    step: { id: 'wait-step' } as unknown as LiFiStepExtended,
    statusManager: {
      findAction: vi.fn((_step: LiFiStepExtended, type: string) =>
        type === actionType ? { type, ...action } : undefined
      ),
    } as unknown as StatusManager,
    isBridgeExecution,
  } as unknown as EthereumStepExecutorContext
}

/** The lane the task ran, and whether it asked the step content. */
const runWait = async (
  action: Partial<ExecutionAction>,
  derived: TransactionMethodType,
  isBridgeExecution = false
): Promise<{ lane: string; derivedLane: boolean }> => {
  vi.mocked(getEthereumExecutionStrategy).mockResolvedValue(derived)
  await new EthereumWaitForTransactionTask().run(
    buildContext(action, isBridgeExecution)
  )
  const ran = Object.entries(lanes).filter(([, run]) => run.mock.calls.length)
  expect(ran).toHaveLength(1)
  return {
    lane: ran[0][0],
    derivedLane: vi.mocked(getEthereumExecutionStrategy).mock.calls.length > 0,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('EthereumWaitForTransactionTask: the wait lane', () => {
  it.each<{
    txType: TransactionMethodType
    open: Partial<ExecutionAction>
    derived: TransactionMethodType
  }>([
    {
      txType: 'relayed',
      open: { taskId: '0x01' },
      derived: 'standard',
    },
    { txType: 'relayed', open: { taskId: '0x01' }, derived: 'batched' },
    { txType: 'batched', open: { taskId: '0x02' }, derived: 'standard' },
    { txType: 'standard', open: { txHash: '0x03' }, derived: 'batched' },
  ])(
    'waits on the stored $txType lane, not the derived $derived lane',
    async ({ txType, open, derived }) => {
      await expect(
        runWait({ status: 'PENDING', txType, ...open }, derived)
      ).resolves.toEqual({ lane: txType, derivedLane: false })
    }
  )

  it('reads the stored lane of a bridge from its CROSS_CHAIN action', async () => {
    await expect(
      runWait(
        { status: 'PENDING', txType: 'relayed', taskId: '0x01' },
        'standard',
        true
      )
    ).resolves.toEqual({ lane: 'relayed', derivedLane: false })
  })

  it('keeps the stored lane for a FAILED action whose outcome is unknown', async () => {
    await expect(
      runWait(
        { status: 'FAILED', txType: 'relayed', taskId: '0x01' },
        'standard'
      )
    ).resolves.toEqual({ lane: 'relayed', derivedLane: false })
  })

  it('derives the lane from the step for a route stored without txType', async () => {
    await expect(
      runWait({ status: 'PENDING', taskId: '0x01' }, 'relayed')
    ).resolves.toEqual({ lane: 'relayed', derivedLane: true })
  })

  it('derives the lane when the txType belongs to no open transaction', async () => {
    await expect(
      runWait({ status: 'PENDING', txType: 'relayed' }, 'standard')
    ).resolves.toEqual({ lane: 'standard', derivedLane: true })
    vi.clearAllMocks()
    await expect(
      runWait(
        {
          status: 'FAILED',
          txFinal: true,
          txType: 'relayed',
          taskId: '0x01',
        },
        'batched'
      )
    ).resolves.toEqual({ lane: 'batched', derivedLane: true })
  })

  it('derives the lane for a txType it does not know', async () => {
    await expect(
      runWait(
        {
          status: 'PENDING',
          txType: 'unknown' as TransactionMethodType,
          taskId: '0x01',
        },
        'relayed'
      )
    ).resolves.toEqual({ lane: 'relayed', derivedLane: true })
  })
})
