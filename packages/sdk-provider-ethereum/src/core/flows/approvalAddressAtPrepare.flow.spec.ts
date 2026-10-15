import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@lifi/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lifi/sdk')>()
  return {
    ...actual,
    getStepTransaction: vi.fn(),
    getRelayerQuote: vi.fn(),
    relayTransaction: vi.fn(),
    // The destination-status watcher polls over HTTP and never settles under
    // test; it runs after everything asserted here.
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

import type { ExtendedChain, LiFiStep } from '@lifi/sdk'
import type { Address, Hex } from 'viem'
import {
  APPROVAL_ADDRESS,
  buildChain,
  buildStep,
  buildTransactionRequest,
  createScenario,
  decodeApproval,
  FROM_ADDRESS,
  FROM_AMOUNT,
  FROM_TOKEN_ADDRESS,
  type Scenario,
  type ScenarioOptions,
} from './harness.mock.js'

const SWAP_CALLDATA: Hex = `0x${'e3'.repeat(36)}`

/** The spender `/stepTransaction` answers with. */
const EXECUTION_SPENDER: Address = '0x5567954cD026CEbFE486062cb75848e0f1c12E58'

/** No Permit2: the spender is `estimate.approvalAddress`. */
const CLASSIC_CHAIN: ExtendedChain = {
  ...buildChain(),
  permit2: undefined,
  permit2Proxy: undefined,
} as unknown as ExtendedChain

/** `/stepTransaction` sets the spender, as Relay's executable quote can. */
const setSpender = (step: LiFiStep): LiFiStep => {
  const { typedData: _typedData, ...rest } = step
  return {
    ...rest,
    estimate: { ...rest.estimate, approvalAddress: EXECUTION_SPENDER },
  }
}

/** A routing-time step with no spender, as an indicative quote gives. */
const buildScenario = (options: Partial<ScenarioOptions> = {}): Scenario =>
  createScenario({
    chain: CLASSIC_CHAIN,
    step: buildStep({
      approvalAddress: '',
      transactionRequest: buildTransactionRequest({ data: SWAP_CALLDATA }),
    }),
    allowance: 0n,
    onStepTransaction: setSpender,
    ...options,
  })

const allowanceReads = (scenario: Scenario): unknown[] =>
  scenario
    .events('readContract')
    .filter(({ functionName }) => functionName === 'allowance')
    .map(({ args }) => args)

const approvedSpender = (data: string | undefined): Address =>
  decodeApproval(data as Hex).spender

beforeEach(() => {
  vi.clearAllMocks()
})

describe('the spender appears at /stepTransaction', () => {
  it('approves it before the swap when it holds no allowance', async () => {
    const scenario = buildScenario()

    await scenario.run()

    expect(allowanceReads(scenario)).toEqual([
      [FROM_ADDRESS, EXECUTION_SPENDER],
    ])
    const sends = scenario.events('sendTransaction')
    expect(sends.map(({ to }) => to)).toEqual([
      FROM_TOKEN_ADDRESS,
      APPROVAL_ADDRESS,
    ])
    expect(approvedSpender(sends[0].data)).toBe(EXECUTION_SPENDER)
    expect(sends[1].data).toBe(SWAP_CALLDATA)
    expect(scenario.events('getStepTransaction')).toHaveLength(1)
  })

  it('sends no approval when its allowance suffices', async () => {
    const scenario = buildScenario({
      allowanceBySpender: { [EXECUTION_SPENDER]: BigInt(FROM_AMOUNT) },
    })

    await scenario.run()

    expect(allowanceReads(scenario)).toEqual([
      [FROM_ADDRESS, EXECUTION_SPENDER],
    ])
    const sends = scenario.events('sendTransaction')
    expect(sends).toHaveLength(1)
    expect(sends[0].data).toBe(SWAP_CALLDATA)
  })

  it('batches the approval with the swap', async () => {
    const scenario = buildScenario({
      capabilities: { atomic: { status: 'supported' } },
    })

    await scenario.run()

    expect(scenario.events('sendTransaction')).toEqual([])
    const [batch] = scenario.events('sendCalls')
    expect(batch.calls).toHaveLength(2)
    expect(approvedSpender(batch.calls[0].data)).toBe(EXECUTION_SPENDER)
    expect(batch.calls[1].data).toBe(SWAP_CALLDATA)
  })
})

describe('the allowance is left alone after prepare', () => {
  it('when the step had a spender before prepare, even if the re-quote moves it', async () => {
    const scenario = buildScenario({
      step: buildStep({
        transactionRequest: buildTransactionRequest({ data: SWAP_CALLDATA }),
      }),
    })

    await scenario.run()

    expect(allowanceReads(scenario)).toEqual([[FROM_ADDRESS, APPROVAL_ADDRESS]])
    const sends = scenario.events('sendTransaction')
    expect(sends).toHaveLength(2)
    expect(approvedSpender(sends[0].data)).toBe(APPROVAL_ADDRESS)
  })

  it('when the re-quote brings no spender either', async () => {
    const scenario = buildScenario({ onStepTransaction: undefined })

    await scenario.run()

    expect(allowanceReads(scenario)).toEqual([])
    const sends = scenario.events('sendTransaction')
    expect(sends).toHaveLength(1)
    expect(sends[0].data).toBe(SWAP_CALLDATA)
  })
})
