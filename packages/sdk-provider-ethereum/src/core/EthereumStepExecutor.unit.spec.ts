import type { LiFiStepExtended, TaskPipeline } from '@lifi/sdk'
import type { Address, Client } from 'viem'
import { describe, expect, it } from 'vitest'
import type { EthereumStepExecutorContext } from '../types.js'
import { EthereumStepExecutor } from './EthereumStepExecutor.js'

const SOURCE_CHAIN = 1
const FROM_ADDRESS = '0xaaaa000000000000000000000000000000000001' as Address
const TOKEN_ADDRESS = '0xcccc000000000000000000000000000000000003' as Address
const APPROVAL_ADDRESS = '0xbbbb000000000000000000000000000000000002'

const buildStep = (): LiFiStepExtended =>
  ({
    type: 'lifi',
    id: 'step-1',
    tool: 'lifi',
    action: {
      fromChainId: SOURCE_CHAIN,
      toChainId: SOURCE_CHAIN,
      fromAddress: FROM_ADDRESS,
      fromAmount: '1000000',
      fromToken: { address: TOKEN_ADDRESS, chainId: SOURCE_CHAIN },
    },
    estimate: {
      approvalAddress: APPROVAL_ADDRESS,
      gasCosts: [],
      feeCosts: [],
    },
    execution: { status: 'PENDING', actions: [] },
  }) as unknown as LiFiStepExtended

const buildContext = (options?: {
  isFromNativeToken?: boolean
}): EthereumStepExecutorContext =>
  ({
    step: buildStep(),
    isBridgeExecution: false,
    isFromNativeToken: options?.isFromNativeToken ?? false,
  }) as unknown as EthereumStepExecutorContext

const taskNames = (pipeline: TaskPipeline): string[] =>
  (
    pipeline as unknown as { tasks: { constructor: { name: string } }[] }
  ).tasks.map((task) => task.constructor.name)

const buildExecutor = (): EthereumStepExecutor =>
  new EthereumStepExecutor({
    routeId: 'route-1',
    client: {} as Client,
  })

describe('EthereumStepExecutor.createPipeline', () => {
  it('runs EthereumSignStepIntentTask after the allowance work and before prepare', () => {
    const names = taskNames(buildExecutor().createPipeline(buildContext()))

    const intent = names.indexOf('EthereumSignStepIntentTask')
    const setAllowance = names.indexOf('EthereumSetAllowanceTask')
    const checkBalance = names.indexOf('EthereumCheckBalanceTask')
    const prepare = names.indexOf('EthereumPrepareTransactionTask')

    expect(intent).toBeGreaterThan(-1)
    expect(setAllowance).toBeGreaterThan(-1)
    expect(checkBalance).toBeGreaterThan(-1)
    expect(prepare).toBeGreaterThan(-1)

    expect(intent).toBeGreaterThan(setAllowance)
    expect(intent).toBeGreaterThan(checkBalance)
    expect(intent).toBeLessThan(prepare)
  })

  it('keeps the intent task before prepare when the pipeline is sliced past the allowance tasks', () => {
    const names = taskNames(
      buildExecutor().createPipeline(buildContext({ isFromNativeToken: true }))
    )

    expect(names[0]).toBe('EthereumCheckBalanceTask')
    expect(names).not.toContain('EthereumSetAllowanceTask')

    const intent = names.indexOf('EthereumSignStepIntentTask')
    const prepare = names.indexOf('EthereumPrepareTransactionTask')

    expect(intent).toBeGreaterThan(-1)
    expect(prepare).toBeGreaterThan(-1)
    expect(intent).toBeLessThan(prepare)
  })
})
