import {
  hasOpenTransaction,
  LiFiErrorCode,
  type LiFiStep,
  type LiFiStepExtended,
  type RouteExtended,
  type StatusManager,
  TransactionError,
} from '@lifi/sdk'
import { type Client, type Hash, MethodNotFoundRpcError } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const statusPlan = vi.hoisted(() => ({ failNext: 0 }))

vi.mock('@lifi/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lifi/sdk')>()
  return {
    ...actual,
    getStepTransaction: vi.fn(),
    getRelayerQuote: vi.fn(),
    relayTransaction: vi.fn(),
    // The terminal destination-status watcher polls `getStatus` over HTTP.
    // Here it fails `statusPlan.failNext` times with the non-final error the
    // real task throws when its poll fails, and then answers DONE.
    WaitForTransactionStatusTask: class WaitForTransactionStatusTask {
      shouldRun = async (): Promise<boolean> => true
      run = async (context: {
        step: LiFiStepExtended
        statusManager: StatusManager
      }): Promise<{ status: 'COMPLETED' }> => {
        if (statusPlan.failNext > 0) {
          statusPlan.failNext -= 1
          throw new actual.TransactionError(
            actual.LiFiErrorCode.TransactionFailed,
            'Failed while waiting for status of destination chain transaction.'
          )
        }
        context.statusManager.updateExecution(context.step, { status: 'DONE' })
        return { status: 'COMPLETED' }
      }
    },
  }
})
vi.mock('../../client/publicClient.js')
vi.mock('../../actions/waitForTransactionReceipt.js')
vi.mock('../../actions/waitForRelayedTransactionReceipt.js')
vi.mock('../../actions/waitForBatchTransactionReceipt.js')

import { waitForBatchTransactionReceipt } from '../../actions/waitForBatchTransactionReceipt.js'
import { waitForTransactionReceipt } from '../../actions/waitForTransactionReceipt.js'
import {
  buildStep,
  buildTransactionRequest,
  createScenario,
  type Scenario,
  type TimelineKind,
} from './harness.mock.js'

// A batched swap keeps the bundle id in `taskId`, and its batched wait can
// also write a receipt hash into `txHash`. A resume waits on the lane that
// sent the bundle (`txType: 'batched'`), even when the wallet of the resume
// reports no batching. A hash alone must not move the resume to the standard
// lane: the hash of one reverted call in a partial batch would make the
// action final there, and the next "Try again" would sign the swap again
// while other calls of the batch may be onchain.

/** The receipt hash of a call that succeeded. */
const OK_HASH: Hash = `0x${'aa'.repeat(32)}`

/** The receipt hash of a call that reverted. */
const REVERTED_HASH: Hash = `0x${'bb'.repeat(32)}`

/** What the wallet answers to `wallet_getCallsStatus`. */
type CallsStatusAnswer =
  | {
      status: 'success' | 'failure'
      statusCode: number
      receipts: { transactionHash: Hash; status: 'success' | 'reverted' }[]
    }
  | 'unsupported'

/** A batch the wallet reports executed, with one successful call. */
const BATCH_SUCCEEDED: CallsStatusAnswer = {
  status: 'success',
  statusCode: 200,
  receipts: [{ transactionHash: OK_HASH, status: 'success' }],
}

/** A partial batch (EIP-5792 600): one call succeeded, one reverted. */
const BATCH_PARTIAL: CallsStatusAnswer = {
  status: 'failure',
  statusCode: 600,
  receipts: [
    { transactionHash: OK_HASH, status: 'success' },
    { transactionHash: REVERTED_HASH, status: 'reverted' },
  ],
}

/** The timeline kinds that sign, send, relay or re-quote. */
const SEND_KINDS: ReadonlySet<TimelineKind> = new Set<TimelineKind>([
  'signTypedData',
  'sendTransaction',
  'sendCalls',
  'relayTransaction',
  'getStepTransaction',
  'getRelayerQuote',
])

interface BatchedScenario {
  scenario: Scenario
  /** The wallet's EIP-5792 capabilities; delete `atomic` to drop batching. */
  capabilities: Record<string, unknown>
  /** The wallet's next answer to `wallet_getCallsStatus`. */
  wallet: { callsStatus: CallsStatusAnswer }
}

/**
 * An ERC-20 swap on a wallet with batching: the approval and the swap go out
 * in one `sendCalls`. The real batched wait reads the wallet's answer from
 * `wallet.callsStatus`, and the receipt wait answers as the real one does: a
 * reverted receipt is final.
 */
const buildBatchedScenario = async (): Promise<BatchedScenario> => {
  const capabilities: Record<string, unknown> = {
    atomic: { status: 'supported' },
  }
  const wallet: { callsStatus: CallsStatusAnswer } = {
    callsStatus: BATCH_SUCCEEDED,
  }
  const scenario = createScenario({
    step: buildStep({ transactionRequest: buildTransactionRequest() }),
    allowance: 0n,
    capabilities,
    onStepTransaction: (step: LiFiStep) => {
      const { typedData: _typedData, ...rest } = step
      return { ...rest, transactionRequest: buildTransactionRequest() }
    },
  })

  const actual = await vi.importActual<
    typeof import('../../actions/waitForBatchTransactionReceipt.js')
  >('../../actions/waitForBatchTransactionReceipt.js')
  vi.mocked(waitForBatchTransactionReceipt).mockImplementation(
    async (_client, id, onFailed) => {
      const answer = wallet.callsStatus
      const walletClient = {
        waitForCallsStatus: async (): Promise<unknown> => {
          // A wallet without EIP-5792: viem's `waitForCallsStatus` rejects
          // with this error after its retries.
          if (answer === 'unsupported') {
            throw new MethodNotFoundRpcError(
              new Error('The method wallet_getCallsStatus does not exist'),
              { method: 'wallet_getCallsStatus' }
            )
          }
          return answer
        },
      } as unknown as Client
      return actual.waitForBatchTransactionReceipt(walletClient, id, onFailed)
    }
  )
  vi.mocked(waitForTransactionReceipt).mockImplementation(
    async (_client, { txHash }) => {
      if (txHash === REVERTED_HASH) {
        throw new TransactionError(
          LiFiErrorCode.TransactionFailed,
          'Transaction was reverted.',
          undefined,
          { final: true }
        )
      }
      return { transactionHash: txHash, status: 'success' } as never
    }
  )

  return { scenario, capabilities, wallet }
}

const swapOf = (route: RouteExtended) =>
  route.steps[0].execution?.actions.find((action) => action.type === 'SWAP')

/** What one run leaves behind: the SWAP action, its lanes and its sends. */
interface Outcome {
  rejected: boolean
  txHash: string | undefined
  txType: string | undefined
  txFinal: boolean | undefined
  open: boolean
  batchedWaits: number
  receiptWaits: number
  sends: TimelineKind[]
}

const runAndRecord = async (
  scenario: Scenario,
  execute: () => Promise<RouteExtended>
): Promise<Outcome> => {
  vi.mocked(waitForBatchTransactionReceipt).mockClear()
  vi.mocked(waitForTransactionReceipt).mockClear()
  const from = scenario.timeline.length
  let rejected = false
  try {
    await execute()
  } catch {
    rejected = true
  }
  const swap = swapOf(scenario.route())
  return {
    rejected,
    txHash: swap?.txHash,
    txType: swap?.txType,
    txFinal: swap?.txFinal,
    open: hasOpenTransaction(swap),
    batchedWaits: vi.mocked(waitForBatchTransactionReceipt).mock.calls.length,
    receiptWaits: vi.mocked(waitForTransactionReceipt).mock.calls.length,
    sends: scenario
      .kinds()
      .slice(from)
      .filter((kind) => SEND_KINDS.has(kind)),
  }
}

/** Two "Try again" in a row, each recorded on its own. */
const resumeTwice = async (scenario: Scenario): Promise<Outcome[]> => [
  await runAndRecord(scenario, scenario.retry),
  await runAndRecord(scenario, scenario.retry),
]

beforeEach(() => {
  vi.clearAllMocks()
  statusPlan.failNext = 0
})

describe('EVM batched wait: a partial batch on resume (P2)', () => {
  it.each([
    { wallet: 'a wallet without batching', keepsBatching: false },
    { wallet: 'the same wallet with batching', keepsBatching: true },
  ])(
    'never signs again when "Try again" runs on $wallet',
    async ({ keepsBatching }) => {
      const { scenario, capabilities, wallet } = await buildBatchedScenario()
      wallet.callsStatus = BATCH_PARTIAL

      // The run sends one bundle. The wallet reports a partial batch: some
      // calls may be onchain, so the outcome is unknown and not final. The
      // reverted receipt leaves its hash in `txHash`.
      const run = await runAndRecord(scenario, scenario.run)
      expect(run).toEqual({
        rejected: true,
        txHash: REVERTED_HASH,
        txType: 'batched',
        txFinal: undefined,
        open: true,
        batchedWaits: 1,
        receiptWaits: 0,
        sends: ['getStepTransaction', 'sendCalls'],
      })

      if (!keepsBatching) {
        delete capabilities.atomic
      }

      // Each resume asks the wallet for the same bundle again and gets the
      // same answer. It never waits on the reverted hash, which would make
      // the action final and let the next "Try again" sign the swap again.
      const unchanged: Outcome = {
        rejected: true,
        txHash: REVERTED_HASH,
        txType: 'batched',
        txFinal: undefined,
        open: true,
        batchedWaits: 1,
        receiptWaits: 0,
        sends: [],
      }
      expect(await resumeTwice(scenario)).toEqual([unchanged, unchanged])
    }
  )
})

describe('EVM batched wait: a resume without the batching wallet (P1)', () => {
  // Characterization of a known gap, not the wanted end state. A batched
  // swap whose receipt is already stored, resumed on a connection that has
  // neither batching nor `wallet_getCallsStatus`, fails without a final
  // outcome on every "Try again" until the batching wallet is back. It never
  // signs again. Follow-up: when the wallet cannot answer for the bundle,
  // fall back to the receipt of the stored hash, and keep any failure of
  // that fallback non-final.
  it('fails non-final and signs nothing on each "Try again"', async () => {
    const { scenario, capabilities, wallet } = await buildBatchedScenario()
    wallet.callsStatus = BATCH_SUCCEEDED
    statusPlan.failNext = 1

    // The bundle executed and its receipt is stored; then one `/status`
    // poll fails, which is not a final outcome.
    const run = await runAndRecord(scenario, scenario.run)
    expect(run).toEqual({
      rejected: true,
      txHash: OK_HASH,
      txType: 'batched',
      txFinal: undefined,
      open: true,
      batchedWaits: 1,
      receiptWaits: 0,
      sends: ['getStepTransaction', 'sendCalls'],
    })

    delete capabilities.atomic
    wallet.callsStatus = 'unsupported'

    const unchanged: Outcome = {
      rejected: true,
      txHash: OK_HASH,
      txType: 'batched',
      txFinal: undefined,
      open: true,
      batchedWaits: 1,
      receiptWaits: 0,
      sends: [],
    }
    expect(await resumeTwice(scenario)).toEqual([unchanged, unchanged])
  })
})
