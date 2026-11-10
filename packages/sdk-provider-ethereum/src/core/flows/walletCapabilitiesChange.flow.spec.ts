import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@lifi/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lifi/sdk')>()
  return {
    ...actual,
    getStepTransaction: vi.fn(),
    getRelayerQuote: vi.fn(),
    relayTransaction: vi.fn(),
    // The terminal destination-status watcher polls `getStatus` over HTTP on a
    // 5s interval and never settles under test. It runs after everything these
    // specs assert on; the rest of the pipeline stays real.
    WaitForTransactionStatusTask: class WaitForTransactionStatusTask {
      shouldRun = async (): Promise<boolean> => true
      run = async (): Promise<{ status: 'COMPLETED' }> => ({
        status: 'COMPLETED',
      })
    },
  }
})
vi.mock('../../client/publicClient.js')
vi.mock('../../actions/waitForTransactionReceipt.js')
vi.mock('../../actions/waitForRelayedTransactionReceipt.js')

import type { Hex } from 'viem'
import {
  APPROVAL_ADDRESS,
  buildStep,
  buildTransactionRequest,
  CANONICAL_PERMIT2,
  createScenario,
  decodeApproval,
  FROM_TOKEN_ADDRESS,
  LIFI_PERMIT2_PROXY,
  type Scenario,
} from './harness.mock.js'

const SUPPORTED = { atomic: { status: 'supported' } }

/**
 * A wallet whose `wallet_getCapabilities` read fails at the listed calls and
 * answers "supported" at every other one. A late answer reads the same way as
 * a failure: `isBatchingSupported` races the read against a 2-second sleep and
 * treats both as "no batching".
 */
const flakyWallet =
  (failingCalls: number[]) =>
  async (callIndex: number): Promise<Record<string, unknown>> => {
    if (failingCalls.includes(callIndex)) {
      throw new Error('wallet_getCapabilities did not answer')
    }
    return SUPPORTED
  }

/**
 * The JUMPER-FRONT-BY shape: a LI.FI ERC-20 step on a Permit2 chain, an EOA, no
 * allowance yet, and a re-quote that answers with a transaction. Permit2 is
 * what makes a strategy change visible: `batched` approves the diamond, while
 * `standard` approves canonical Permit2.
 */
const buildFlakyWalletScenario = (failingCalls: number[]): Scenario =>
  createScenario({
    step: buildStep({ transactionRequest: buildTransactionRequest() }),
    allowance: 0n,
    accountCode: '0x',
    nativePermitSupported: false,
    onGetCapabilities: flakyWallet(failingCalls),
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('C17 — a step uses one wallet capabilities answer', () => {
  it('stays batched when the wallet fails to answer at prepare', async () => {
    // Before the fix: the allowance tasks ran batched (read 0), prepare read
    // "no batching" (read 1) and replayed the step as standard, and the
    // replay's prepare read "supported" (read 2). The standard replay had
    // approved Permit2, which `batched` never uses, so the step failed with
    // `TransactionUnprepared`.
    const scenario = buildFlakyWalletScenario([1])

    await expect(scenario.run()).resolves.toBeDefined()

    expect(scenario.events('sendTransaction')).toEqual([])
    const batches = scenario.events('sendCalls')
    expect(batches).toHaveLength(1)
    expect(batches[0].calls).toHaveLength(2)
    const [approve, swap] = batches[0].calls
    expect(approve.to).toBe(FROM_TOKEN_ADDRESS)
    expect(decodeApproval(approve.data as Hex).spender).toBe(APPROVAL_ADDRESS)
    expect(swap.to).toBe(APPROVAL_ADDRESS)

    expect(scenario.events('getStepTransaction')).toHaveLength(1)
    expect(scenario.events('getCapabilities')).toHaveLength(1)
  })

  it('stays standard when the wallet fails to answer first and answers at prepare', async () => {
    // Before the fix: the allowance tasks ran standard (read 0 failed) and
    // approved Permit2. Prepare read "supported" (read 1) and moved the step
    // to `batched`, so the swap went to the diamond in a batch, with no
    // allowance for the diamond and no Permit2 signature.
    const scenario = buildFlakyWalletScenario([0])

    await expect(scenario.run()).resolves.toBeDefined()

    expect(scenario.events('sendCalls')).toEqual([])
    const transactions = scenario.events('sendTransaction')
    expect(transactions).toHaveLength(2)
    const [approveTx, swapTx] = transactions
    expect(approveTx.to).toBe(FROM_TOKEN_ADDRESS)
    expect(decodeApproval(approveTx.data as Hex).spender).toBe(
      CANONICAL_PERMIT2
    )
    expect(
      scenario.events('signTypedData').map((event) => event.primaryType)
    ).toEqual(['PermitTransferFrom'])
    expect(swapTx.to).toBe(LIFI_PERMIT2_PROXY)

    expect(scenario.events('getCapabilities')).toHaveLength(1)
  })
})
