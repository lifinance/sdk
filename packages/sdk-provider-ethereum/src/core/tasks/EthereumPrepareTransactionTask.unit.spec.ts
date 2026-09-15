import {
  LiFiErrorCode,
  type LiFiStep,
  type LiFiStepExtended,
  type TypedData,
} from '@lifi/sdk'
import type { Address, Hex } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./helpers/getUpdatedStep.js', () => ({
  getUpdatedStep: vi.fn(),
}))

vi.mock('./helpers/getEthereumExecutionStrategy.js', () => ({
  getEthereumExecutionStrategy: vi.fn(),
}))

import type { EthereumStepExecutorContext } from '../../types.js'
import { EthereumPrepareTransactionTask } from './EthereumPrepareTransactionTask.js'
import { getEthereumExecutionStrategy } from './helpers/getEthereumExecutionStrategy.js'
import { getUpdatedStep } from './helpers/getUpdatedStep.js'

const SOURCE_CHAIN = 1
const FROM_ADDRESS = '0xaaaa000000000000000000000000000000000001' as Address
const TOKEN_ADDRESS = '0xcccc000000000000000000000000000000000003' as Address
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address
const UNIVERSAL_ROUTER = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af' as Address
const ROUTER_CALLDATA = '0xdeadbeef' as Hex

const callerIntent = (): TypedData =>
  ({
    primaryType: 'PermitSingle',
    domain: { chainId: SOURCE_CHAIN, verifyingContract: PERMIT2 },
    types: {},
    message: { spender: UNIVERSAL_ROUTER },
  }) as unknown as TypedData

const witness = (): TypedData =>
  ({
    primaryType: 'PermitWitnessTransferFrom',
    domain: { chainId: SOURCE_CHAIN, verifyingContract: PERMIT2 },
    types: {},
    message: {},
  }) as unknown as TypedData

const buildStep = (typedData: TypedData[]): LiFiStepExtended =>
  ({
    type: 'lifi',
    id: 'step-1',
    tool: 'uniswap',
    action: {
      fromChainId: SOURCE_CHAIN,
      toChainId: SOURCE_CHAIN,
      fromAddress: FROM_ADDRESS,
      fromAmount: '1000000',
      slippage: 0.03,
      fromToken: { address: TOKEN_ADDRESS, chainId: SOURCE_CHAIN },
      toToken: { address: TOKEN_ADDRESS, chainId: SOURCE_CHAIN },
    },
    estimate: {
      approvalAddress: PERMIT2,
      toAmount: '990000',
      toAmountMin: '980000',
      gasCosts: [],
      feeCosts: [],
    },
    execution: { status: 'PENDING', actions: [{ type: 'SWAP' }] },
    typedData,
  }) as unknown as LiFiStepExtended

const buildApiAnswer = (typedData: TypedData[]): LiFiStep =>
  ({
    type: 'lifi',
    id: 'step-1',
    tool: 'uniswap',
    action: {
      fromChainId: SOURCE_CHAIN,
      toChainId: SOURCE_CHAIN,
      fromAddress: FROM_ADDRESS,
      fromAmount: '1000000',
      fromToken: { address: TOKEN_ADDRESS, chainId: SOURCE_CHAIN },
      toToken: { address: TOKEN_ADDRESS, chainId: SOURCE_CHAIN },
    },
    estimate: {
      approvalAddress: PERMIT2,
      toAmount: '990000',
      toAmountMin: '980000',
      gasCosts: [],
      feeCosts: [],
    },
    transactionRequest: {
      chainId: SOURCE_CHAIN,
      from: FROM_ADDRESS,
      to: UNIVERSAL_ROUTER,
      data: ROUTER_CALLDATA,
    },
    typedData,
  }) as unknown as LiFiStep

const buildContext = (step: LiFiStepExtended): EthereumStepExecutorContext =>
  ({
    step,
    client: {},
    fromChain: { id: SOURCE_CHAIN, permit2: PERMIT2 },
    isBridgeExecution: false,
    allowUserInteraction: true,
    signedTypedData: [],
    ethereumClient: {},
    checkClient: vi.fn(),
    statusManager: {
      findAction: vi.fn().mockReturnValue({ type: 'SWAP' }),
      updateAction: vi.fn(),
      updateStepInRoute: vi.fn((updated: LiFiStep) => updated),
    },
  }) as unknown as EthereumStepExecutorContext

const task = new EthereumPrepareTransactionTask()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getEthereumExecutionStrategy).mockResolvedValue('standard')
})

describe('EthereumPrepareTransactionTask.run', () => {
  it('keeps the caller intent on the shared step when the API answers with typedData: []', async () => {
    const step = buildStep([callerIntent()])
    vi.mocked(getUpdatedStep).mockResolvedValue(
      buildApiAnswer([]) as LiFiStepExtended
    )

    const result = await task.run(buildContext(step))

    expect(result.status).toBe('COMPLETED')
    expect(step.typedData).toHaveLength(1)
    expect(step.typedData?.[0].primaryType).toBe('PermitSingle')
  })

  it('still lets the API clear the typed data of a relayer step', async () => {
    const step = buildStep([witness()])
    vi.mocked(getUpdatedStep).mockResolvedValue(
      buildApiAnswer([]) as LiFiStepExtended
    )

    await task.run(buildContext(step))

    expect(step.typedData).toHaveLength(0)
  })

  it('takes the API answer verbatim when it echoes the caller intent', async () => {
    const step = buildStep([callerIntent()])
    const answer = [callerIntent()]
    vi.mocked(getUpdatedStep).mockResolvedValue(
      buildApiAnswer(answer) as LiFiStepExtended
    )

    await task.run(buildContext(step))

    expect(step.typedData).toBe(answer)
  })

  it('throws TransactionUnprepared when the API answers with neither a transaction request nor typed data, even though a caller intent is preserved', async () => {
    const step = buildStep([callerIntent()])
    const { transactionRequest: _, ...answer } = buildApiAnswer([])
    vi.mocked(getUpdatedStep).mockResolvedValue(answer as LiFiStepExtended)

    await expect(task.run(buildContext(step))).rejects.toMatchObject({
      name: 'TransactionError',
      code: LiFiErrorCode.TransactionUnprepared,
      message:
        'Unable to prepare transaction. Transaction request is not found.',
    })
  })
})
