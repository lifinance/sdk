import type { ExecutionAction, LiFiStepExtended, TaskPipeline } from '@lifi/sdk'
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
  isBridgeExecution?: boolean
}): EthereumStepExecutorContext =>
  ({
    step: buildStep(),
    isBridgeExecution: options?.isBridgeExecution ?? false,
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
  it('runs EthereumPermit2AllowanceTask after the allowance work and before prepare', () => {
    const names = taskNames(buildExecutor().createPipeline(buildContext()))

    const permit2Allowance = names.indexOf('EthereumPermit2AllowanceTask')
    const setAllowance = names.indexOf('EthereumSetAllowanceTask')
    const checkBalance = names.indexOf('EthereumCheckBalanceTask')
    const prepare = names.indexOf('EthereumPrepareTransactionTask')

    expect(permit2Allowance).toBeGreaterThan(-1)
    expect(setAllowance).toBeGreaterThan(-1)
    expect(checkBalance).toBeGreaterThan(-1)
    expect(prepare).toBeGreaterThan(-1)

    expect(permit2Allowance).toBeGreaterThan(setAllowance)
    expect(permit2Allowance).toBeGreaterThan(checkBalance)
    expect(permit2Allowance).toBeLessThan(prepare)
  })

  it('keeps the Permit2 allowance task before prepare when the pipeline is sliced past the allowance tasks', () => {
    const names = taskNames(
      buildExecutor().createPipeline(buildContext({ isFromNativeToken: true }))
    )

    expect(names[0]).toBe('EthereumCheckBalanceTask')
    expect(names).not.toContain('EthereumSetAllowanceTask')

    const permit2Allowance = names.indexOf('EthereumPermit2AllowanceTask')
    const prepare = names.indexOf('EthereumPrepareTransactionTask')

    expect(permit2Allowance).toBeGreaterThan(-1)
    expect(prepare).toBeGreaterThan(-1)
    expect(permit2Allowance).toBeLessThan(prepare)
  })
})

const TX_HASH = `0x${'ab'.repeat(32)}`

const buildContextWithSwap = (
  swapAction: Omit<ExecutionAction, 'type'>,
  options?: { isFromNativeToken?: boolean }
): EthereumStepExecutorContext => {
  const context = buildContext(options)
  context.step.execution!.actions = [{ type: 'SWAP', ...swapAction }]
  return context
}

const buildContextWithBridge = (
  bridgeAction: Omit<ExecutionAction, 'type'>,
  options?: { isFromNativeToken?: boolean }
): EthereumStepExecutorContext => {
  const context = buildContext({ ...options, isBridgeExecution: true })
  context.step.execution!.actions = [{ type: 'CROSS_CHAIN', ...bridgeAction }]
  return context
}

describe('EthereumStepExecutor.createPipeline resume entry', () => {
  it('signs again from EthereumCheckBalanceTask after a final failure (native token)', () => {
    const names = taskNames(
      buildExecutor().createPipeline(
        buildContextWithSwap(
          { status: 'FAILED', txHash: TX_HASH, txFinal: true },
          { isFromNativeToken: true }
        )
      )
    )

    expect(names[0]).toBe('EthereumCheckBalanceTask')
    expect(names).toContain('EthereumSignAndExecuteTask')
  })

  it('re-checks permits and allowance after a final failure (ERC20)', () => {
    const names = taskNames(
      buildExecutor().createPipeline(
        buildContextWithSwap({
          status: 'FAILED',
          txHash: TX_HASH,
          txFinal: true,
        })
      )
    )

    expect(names[0]).toBe('EthereumCheckPermitsTask')
  })

  it('signs again from EthereumCheckBalanceTask after a final batch or relay failure (taskId)', () => {
    const names = taskNames(
      buildExecutor().createPipeline(
        buildContextWithSwap(
          { status: 'FAILED', taskId: TX_HASH, txFinal: true },
          { isFromNativeToken: true }
        )
      )
    )

    expect(names[0]).toBe('EthereumCheckBalanceTask')
    expect(names).toContain('EthereumSignAndExecuteTask')
  })

  it('waits for a FAILED transaction without txFinal instead of signing', () => {
    const names = taskNames(
      buildExecutor().createPipeline(
        buildContextWithSwap({ status: 'FAILED', txHash: TX_HASH })
      )
    )

    expect(names[0]).toBe('EthereumWaitForTransactionTask')
    expect(names).not.toContain('EthereumSignAndExecuteTask')
  })

  it('waits for a pending batch or relay taskId', () => {
    const names = taskNames(
      buildExecutor().createPipeline(
        buildContextWithSwap({ status: 'PENDING', taskId: TX_HASH })
      )
    )

    expect(names[0]).toBe('EthereumWaitForTransactionTask')
  })

  it('goes to the status wait once the transaction is DONE', () => {
    const names = taskNames(
      buildExecutor().createPipeline(
        buildContextWithSwap({ status: 'DONE', txHash: TX_HASH })
      )
    )

    expect(names).toEqual(['EthereumWaitForTransactionStatusTask'])
  })
})

describe('EthereumStepExecutor.createPipeline resume entry (bridge)', () => {
  it('signs again from EthereumCheckBalanceTask after a final failure (native token)', () => {
    const names = taskNames(
      buildExecutor().createPipeline(
        buildContextWithBridge(
          { status: 'FAILED', txHash: TX_HASH, txFinal: true },
          { isFromNativeToken: true }
        )
      )
    )

    expect(names[0]).toBe('EthereumCheckBalanceTask')
    expect(names).toContain('EthereumSignAndExecuteTask')
  })

  it('re-checks permits and allowance after a final failure (ERC20)', () => {
    const names = taskNames(
      buildExecutor().createPipeline(
        buildContextWithBridge({
          status: 'FAILED',
          txHash: TX_HASH,
          txFinal: true,
        })
      )
    )

    expect(names[0]).toBe('EthereumCheckPermitsTask')
  })

  it('waits for a FAILED transaction without txFinal instead of signing', () => {
    const names = taskNames(
      buildExecutor().createPipeline(
        buildContextWithBridge({ status: 'FAILED', txHash: TX_HASH })
      )
    )

    expect(names[0]).toBe('EthereumWaitForTransactionTask')
    expect(names).not.toContain('EthereumSignAndExecuteTask')
  })

  it('waits for a pending batch or relay taskId', () => {
    const names = taskNames(
      buildExecutor().createPipeline(
        buildContextWithBridge({ status: 'PENDING', taskId: TX_HASH })
      )
    )

    expect(names[0]).toBe('EthereumWaitForTransactionTask')
  })

  it('waits for an action with only stored bytes (txHex) instead of signing', () => {
    const names = taskNames(
      buildExecutor().createPipeline(
        buildContextWithBridge(
          { status: 'PENDING', txHex: '0x02f8' },
          { isFromNativeToken: true }
        )
      )
    )

    expect(names[0]).toBe('EthereumWaitForTransactionTask')
    expect(names).not.toContain('EthereumSignAndExecuteTask')
  })

  it('goes to the status wait once the transaction is DONE', () => {
    const names = taskNames(
      buildExecutor().createPipeline(
        buildContextWithBridge({ status: 'DONE', txHash: TX_HASH })
      )
    )

    expect(names).toEqual(['EthereumWaitForTransactionStatusTask'])
  })
})
