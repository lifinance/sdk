import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@lifi/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lifi/sdk')>()
  return {
    ...actual,
    ...(await import('./actionControls.mock.js')).recordRouteUpdates(actual),
    getStepTransaction: vi.fn(),
    getRelayerQuote: vi.fn(),
    relayTransaction: vi.fn(),
  }
})
vi.mock('../../client/publicClient.js')
vi.mock('../../actions/waitForTransactionReceipt.js')
vi.mock('../../actions/waitForRelayedTransactionReceipt.js')
vi.mock('../../EthereumProvider.js', async (importOriginal) =>
  (await import('./actionControls.mock.js')).mockEthereumProviderModule(
    await importOriginal()
  )
)

import type { ExtendedChain, LiFiStep, SDKError } from '@lifi/sdk'
import type { Hex } from 'viem'
import {
  createStatusApi,
  type StatusApi,
  walletControls,
} from './actionControls.mock.js'
import {
  APPROVAL_ADDRESS,
  buildChain,
  buildStep,
  buildTransactionRequest,
  CHAIN_ID,
  createScenario,
  FROM_AMOUNT,
  FROM_TOKEN_ADDRESS,
  type Scenario,
  TO_TOKEN,
} from './harness.mock.js'

const SWAP_CALLDATA: Hex = `0x${'4e'.repeat(36)}`

const buildScenario = (allowance: bigint, approvalReset: boolean): Scenario =>
  createScenario({
    chain: {
      ...buildChain(),
      permit2: undefined,
      permit2Proxy: undefined,
    } as unknown as ExtendedChain,
    step: buildStep({
      transactionRequest: buildTransactionRequest({ data: SWAP_CALLDATA }),
      approvalReset,
    }),
    allowance,
    nativePermitSupported: false,
    accountCode: '0x',
    onStepTransaction: (requested: LiFiStep) => {
      const { typedData: _typedData, ...rest } = requested
      return {
        ...rest,
        transactionRequest: buildTransactionRequest({ data: SWAP_CALLDATA }),
      } as LiFiStep
    },
  })

let statusApi: StatusApi

beforeEach(() => {
  vi.clearAllMocks()
  walletControls.reset()
  walletControls.sendAnswers.push(null)
  statusApi = createStatusApi({
    chainId: CHAIN_ID,
    fromAmount: FROM_AMOUNT,
    toToken: TO_TOKEN,
    toAmount: FROM_AMOUNT,
  })
  vi.stubGlobal('fetch', statusApi.fetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
  expect(statusApi.unknown).toEqual([])
})

describe.each([
  {
    lane: 'swap',
    allowance: BigInt(FROM_AMOUNT),
    approvalReset: false,
    actionType: 'SWAP',
    firstPromptTo: APPROVAL_ADDRESS,
    sendsAfterRetry: 1,
  },
  {
    lane: 'approval',
    allowance: 0n,
    approvalReset: false,
    actionType: 'SET_ALLOWANCE',
    firstPromptTo: FROM_TOKEN_ADDRESS,
    sendsAfterRetry: 2,
  },
  {
    lane: 'approval reset',
    allowance: 1000n,
    approvalReset: true,
    actionType: 'RESET_ALLOWANCE',
    firstPromptTo: FROM_TOKEN_ADDRESS,
    sendsAfterRetry: 3,
  },
])(
  'the wallet answers the $lane prompt with null',
  ({
    allowance,
    approvalReset,
    actionType,
    firstPromptTo,
    sendsAfterRetry,
  }) => {
    it('fails the step with TransactionFailed and keeps no transaction', async () => {
      const scenario = buildScenario(allowance, approvalReset)

      const error = (await scenario.runExpectingFailure()) as SDKError

      expect(error.code).toBe(1003)
      expect(walletControls.sendAttempts.map((attempt) => attempt.to)).toEqual([
        firstPromptTo,
      ])
      expect(scenario.events('sendTransaction')).toEqual([])
      const execution = scenario.executedStep().execution!
      expect(execution.status).toBe('FAILED')
      expect(execution.error?.code).toBe(1003)
      expect(execution.error?.message).toContain(
        'did not return a transaction hash'
      )
      const action = execution.actions.find((a) => a.type === actionType)
      expect(action?.status).toBe('FAILED')
      expect(action?.txHash).toBeUndefined()
    })

    it('asks the wallet again on "Try again" and completes', async () => {
      const scenario = buildScenario(allowance, approvalReset)
      await scenario.runExpectingFailure()

      await scenario.retry()

      expect(walletControls.sendAttempts[1]?.to).toBe(firstPromptTo)
      expect(scenario.events('sendTransaction')).toHaveLength(sendsAfterRetry)
      const execution = scenario.executedStep().execution!
      expect(execution.status).toBe('DONE')
      expect(execution.error).toBeUndefined()
    })
  }
)
