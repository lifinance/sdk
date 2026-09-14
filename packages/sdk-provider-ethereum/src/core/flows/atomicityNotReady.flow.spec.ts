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

import { AtomicReadyWalletRejectedUpgradeError } from 'viem'
import {
  APPROVAL_ADDRESS,
  buildStep,
  buildTransactionRequest,
  createScenario,
  FROM_TOKEN_ADDRESS,
  LIFI_PERMIT2_PROXY,
  type Scenario,
} from './harness.mock.js'

/**
 * A wallet that advertises EIP-5792 atomic batching and then declines the
 * EIP-7702 upgrade when the batch is actually submitted.
 *
 * `parseEthereumErrors.ts:127-141` recognises it by `e.cause.code === 5750`,
 * turns it into an `ExecuteStepRetryError`, and `execution.ts:143-150` re-runs
 * `executeStep` with `{ atomicityNotReady: true }` after clearing
 * `step.execution`. `getEthereumExecutionStrategy.ts:35` then forces
 * `'standard'`, so the whole step replays without batching.
 */
const buildDeclinedUpgradeScenario = (): Scenario => {
  let sendCallsAttempts = 0
  return createScenario({
    step: buildStep({ transactionRequest: buildTransactionRequest() }),
    allowance: 0n,
    capabilities: { atomic: { status: 'supported' } },
    onSendCalls: async () => {
      sendCallsAttempts += 1
      const rejection = new Error('Wallet declined the 7702 upgrade.')
      // viem surfaces the wallet's EIP-5792 error as the `cause`; the detector
      // reads `e.cause.code`, never the top-level error.
      Object.defineProperty(rejection, 'cause', {
        value: new AtomicReadyWalletRejectedUpgradeError(
          new Error(`Rejected on attempt ${sendCallsAttempts}.`)
        ),
      })
      throw rejection
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('C12 — the wallet declines the 7702 upgrade and the step replays unbatched', () => {
  it('retries once and completes through the standard path', async () => {
    const scenario = buildDeclinedUpgradeScenario()

    await expect(scenario.run()).resolves.toBeDefined()

    // One batch attempt, rejected; then two standalone transactions — the
    // approve and the swap — which is exactly what C8 does *not* do.
    expect(scenario.events('sendCalls')).toHaveLength(1)
    const sent = scenario.events('sendTransaction')
    expect(sent).toHaveLength(2)
    expect(sent[0].to).toBe(FROM_TOKEN_ADDRESS)
    // The swap goes to the Permit2Proxy, not the diamond the quote named:
    // dropping the batch re-enables Permit2 (`resolvePermit2Support` rejects
    // only the `batched` strategy), so the retry is C7's lane, not C8's.
    expect(sent[1].to).toBe(LIFI_PERMIT2_PROXY)
    expect(sent[1].to).not.toBe(APPROVAL_ADDRESS)
    // The batch was attempted before either standalone transaction.
    expect(scenario.events('sendCalls')[0].seq).toBeLessThan(sent[0].seq)
  })

  it('discards the actions of the first attempt rather than continuing them', async () => {
    const scenario = buildDeclinedUpgradeScenario()

    await scenario.run()

    // Pinned as observed. `execution.ts:144` sets `step.execution = undefined`
    // before the retry, so `initializeExecution` builds a fresh one and the
    // consumer's action list restarts from empty — including the
    // `SET_ALLOWANCE:DONE` the first attempt had already reported (see C8's
    // deliberate pin on that early DONE). The first attempt's SWAP action is
    // never marked FAILED: `ExecuteStepRetryError` short-circuits the FAILED
    // branch in `BaseStepExecutor.ts:108`.
    expect(
      scenario
        .events('action')
        .map((event) => `${event.actionType}:${event.status}`)
    ).toEqual([
      // Attempt 1 — batched.
      'CHECK_ALLOWANCE:STARTED',
      'CHECK_ALLOWANCE:DONE',
      'SET_ALLOWANCE:STARTED',
      'SET_ALLOWANCE:ACTION_REQUIRED',
      'SET_ALLOWANCE:DONE',
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      // Attempt 2 — standard, from a cleared execution object.
      'CHECK_ALLOWANCE:STARTED',
      'CHECK_ALLOWANCE:DONE',
      'NATIVE_PERMIT:STARTED',
      'NATIVE_PERMIT:DONE',
      'SET_ALLOWANCE:STARTED',
      'SET_ALLOWANCE:ACTION_REQUIRED',
      'SET_ALLOWANCE:PENDING',
      'SET_ALLOWANCE:DONE',
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:MESSAGE_REQUIRED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
    ])

    // Four entries, not seven: the list a consumer renders carries only the
    // second attempt.
    expect(scenario.finalActions()).toEqual([
      'CHECK_ALLOWANCE:DONE',
      'NATIVE_PERMIT:DONE',
      'SET_ALLOWANCE:DONE',
      'SWAP:PENDING',
    ])
  })

  it('runs the native-permit probe only on the retry', async () => {
    const scenario = buildDeclinedUpgradeScenario()

    await scenario.run()

    // `EthereumNativePermitTask.shouldRun` refuses a batched strategy, so the
    // first attempt skips it; forcing `'standard'` lets it through on the
    // second. The consumer sees a NATIVE_PERMIT action appear out of nowhere
    // after the wallet declined the upgrade.
    expect(
      scenario
        .events('action')
        .filter((event) => event.actionType === 'NATIVE_PERMIT')
    ).toHaveLength(2)
  })
})
