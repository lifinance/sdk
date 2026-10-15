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

/** The spender `/stepTransaction` answers with, unlike the routing-time one. */
const EXECUTION_SPENDER: Address = '0x5567954cD026CEbFE486062cb75848e0f1c12E58'

/** No Permit2: the spender is `estimate.approvalAddress`. */
const CLASSIC_CHAIN: ExtendedChain = {
  ...buildChain(),
  permit2: undefined,
  permit2Proxy: undefined,
} as unknown as ExtendedChain

/** `/stepTransaction` moves the spender, as Relay's executable quote can. */
const moveSpender = (step: LiFiStep): LiFiStep => {
  const { typedData: _typedData, ...rest } = step
  return {
    ...rest,
    estimate: { ...rest.estimate, approvalAddress: EXECUTION_SPENDER },
  }
}

const buildScenario = (options: Partial<ScenarioOptions> = {}): Scenario =>
  createScenario({
    chain: CLASSIC_CHAIN,
    step: buildStep({
      transactionRequest: buildTransactionRequest({ data: SWAP_CALLDATA }),
    }),
    allowance: 0n,
    onStepTransaction: moveSpender,
    ...options,
  })

const approvedSpenders = (data: (string | undefined)[]): Address[] =>
  data.map((calldata) => decodeApproval(calldata as Hex).spender)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('the spender moves at /stepTransaction', () => {
  it('approves the new spender before the swap when it holds no allowance', async () => {
    const scenario = buildScenario()

    await scenario.run()

    const sends = scenario.events('sendTransaction')
    expect(sends.map(({ to }) => to)).toEqual([
      FROM_TOKEN_ADDRESS,
      FROM_TOKEN_ADDRESS,
      APPROVAL_ADDRESS,
    ])
    // The routing-time approval is already on-chain; the second one is the
    // allowance the swap pulls through.
    expect(approvedSpenders(sends.slice(0, 2).map(({ data }) => data))).toEqual(
      [APPROVAL_ADDRESS, EXECUTION_SPENDER]
    )
    expect(sends[2].data).toBe(SWAP_CALLDATA)
    expect(scenario.events('getStepTransaction')).toHaveLength(1)
  })

  it('reads the new allowance and sends no second approval when it suffices', async () => {
    const scenario = buildScenario({
      allowanceBySpender: { [EXECUTION_SPENDER]: BigInt(FROM_AMOUNT) },
    })

    await scenario.run()

    expect(
      scenario
        .events('readContract')
        .filter(({ functionName }) => functionName === 'allowance')
        .map(({ args }) => args)
    ).toEqual([
      [FROM_ADDRESS, APPROVAL_ADDRESS],
      [FROM_ADDRESS, EXECUTION_SPENDER],
    ])
    const sends = scenario.events('sendTransaction')
    expect(sends).toHaveLength(2)
    expect(approvedSpenders([sends[0].data])).toEqual([APPROVAL_ADDRESS])
    expect(sends[1].data).toBe(SWAP_CALLDATA)
  })

  it('batches the approval for the new spender only', async () => {
    const scenario = buildScenario({
      capabilities: { atomic: { status: 'supported' } },
    })

    await scenario.run()

    expect(scenario.events('sendTransaction')).toEqual([])
    const [batch] = scenario.events('sendCalls')
    expect(batch.calls).toHaveLength(2)
    expect(approvedSpenders([batch.calls[0].data])).toEqual([EXECUTION_SPENDER])
    expect(batch.calls[1].data).toBe(SWAP_CALLDATA)
  })

  it('checks the allowance once when the spender holds', async () => {
    const scenario = buildScenario({ onStepTransaction: undefined })

    await scenario.run()

    expect(
      scenario
        .events('readContract')
        .filter(({ functionName }) => functionName === 'allowance')
    ).toHaveLength(1)
    expect(scenario.events('sendTransaction')).toHaveLength(2)
  })
})
