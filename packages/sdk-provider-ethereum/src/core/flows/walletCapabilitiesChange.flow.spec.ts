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

import {
  AtomicityNotSupportedError,
  type Hex,
  UnsupportedNonOptionalCapabilityError,
} from 'viem'
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

// `isBatchingSupported` treats a failed read and a read slower than 2s alike.
const flakyWallet =
  (failingCalls: number[]) =>
  async (callIndex: number): Promise<Record<string, unknown>> => {
    if (failingCalls.includes(callIndex)) {
      throw new Error('wallet_getCapabilities did not answer')
    }
    return SUPPORTED
  }

// On a Permit2 chain the strategies approve different spenders: `batched` the
// diamond, `standard` canonical Permit2.
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
    // Before the fix: a standard replay approved Permit2, then read "supported"
    // and failed with `TransactionUnprepared` (JUMPER-FRONT-BY).
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
    // Before the fix: Permit2 was approved, then the swap went to the diamond in
    // a batch with no diamond allowance.
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

  it('stays on the Permit2 lane with an existing Permit2 allowance when the wallet fails to answer first', async () => {
    // Before the fix: the guard does not replay a first standard run, so the
    // swap went to the diamond in a batch with no diamond allowance.
    const scenario = createScenario({
      step: buildStep({ transactionRequest: buildTransactionRequest() }),
      allowanceBySpender: {
        [CANONICAL_PERMIT2]: 10n ** 30n,
        [APPROVAL_ADDRESS]: 0n,
      },
      accountCode: '0x',
      nativePermitSupported: false,
      onGetCapabilities: flakyWallet([0]),
    })

    await expect(scenario.run()).resolves.toBeDefined()

    expect(scenario.events('sendCalls')).toEqual([])
    const transactions = scenario.events('sendTransaction')
    expect(transactions).toHaveLength(1)
    expect(transactions[0].to).toBe(LIFI_PERMIT2_PROXY)
    expect(
      scenario.events('signTypedData').map((event) => event.primaryType)
    ).toEqual(['PermitTransferFrom'])
    expect(scenario.events('getCapabilities')).toHaveLength(1)
  })
})

const UNSUPPORTED = { atomic: { status: 'unsupported' } }

// EIP-5792 lets capabilities change, e.g. the user turns off a smart account.
const buildBatchingTurnedOffScenario = (
  buildError: (cause: Error) => Error
): Scenario =>
  createScenario({
    step: buildStep({ transactionRequest: buildTransactionRequest() }),
    allowance: 0n,
    accountCode: '0x',
    nativePermitSupported: false,
    onGetCapabilities: async (callIndex) =>
      callIndex === 0 ? SUPPORTED : UNSUPPORTED,
    // "Try again" clears the transaction, and the real endpoint sends a new one.
    onStepTransaction: ({ typedData: _typedData, ...step }) => ({
      ...step,
      transactionRequest: buildTransactionRequest(),
    }),
    onSendCalls: async () => {
      const failure = new Error('The wallet does not batch these calls.')
      Object.defineProperty(failure, 'cause', {
        value: buildError(new Error('Batching is off.')),
      })
      throw failure
    },
  })

describe('C17 — the wallet stops batching after the read', () => {
  it.each([
    [
      'AtomicityNotSupportedError (5760)',
      (cause: Error): Error => new AtomicityNotSupportedError(cause),
    ],
    [
      'UnsupportedNonOptionalCapabilityError (5700)',
      (cause: Error): Error => new UnsupportedNonOptionalCapabilityError(cause),
    ],
  ])(
    'fails the step and sends nothing outside the refused batch when wallet_sendCalls throws %s',
    async (_, buildError) => {
      const scenario = buildBatchingTurnedOffScenario(buildError)

      await scenario.runExpectingFailure()

      expect(scenario.events('sendTransaction')).toEqual([])
      expect(scenario.events('signTypedData')).toEqual([])
      const batches = scenario.events('sendCalls')
      expect(batches).toHaveLength(1)
      expect(batches[0].calls).toHaveLength(2)
      expect(scenario.executedStep().execution?.status).toBe('FAILED')
    }
  )

  it('reads the wallet again on "Try again" and completes in standard', async () => {
    const scenario = buildBatchingTurnedOffScenario(
      (cause) => new AtomicityNotSupportedError(cause)
    )
    await scenario.runExpectingFailure()
    const retryStartsAt = scenario.timeline.length

    await expect(scenario.retry()).resolves.toBeDefined()

    expect(scenario.events('getCapabilities', retryStartsAt)).toHaveLength(1)
    expect(scenario.events('sendCalls', retryStartsAt)).toEqual([])
    const transactions = scenario.events('sendTransaction', retryStartsAt)
    expect(transactions).toHaveLength(2)
    const [approveTx, swapTx] = transactions
    expect(approveTx.to).toBe(FROM_TOKEN_ADDRESS)
    expect(decodeApproval(approveTx.data as Hex).spender).toBe(
      CANONICAL_PERMIT2
    )
    expect(swapTx.to).toBe(LIFI_PERMIT2_PROXY)
  })
})
