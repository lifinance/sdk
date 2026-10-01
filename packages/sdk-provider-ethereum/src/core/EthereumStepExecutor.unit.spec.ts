import type {
  LiFiStepExtended,
  StepExecutorBaseContext,
  TaskPipeline,
} from '@lifi/sdk'
import type { Address, Client } from 'viem'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EthereumStepExecutorContext } from '../types.js'
import { EthereumStepExecutor } from './EthereumStepExecutor.js'
import { EthereumCheckAllowanceTask } from './tasks/EthereumCheckAllowanceTask.js'
import { EthereumCheckBalanceTask } from './tasks/EthereumCheckBalanceTask.js'
import { EthereumCheckPermitsTask } from './tasks/EthereumCheckPermitsTask.js'
import { EthereumNativePermitTask } from './tasks/EthereumNativePermitTask.js'
import { EthereumPermit2AllowanceTask } from './tasks/EthereumPermit2AllowanceTask.js'
import { EthereumPrepareTransactionTask } from './tasks/EthereumPrepareTransactionTask.js'
import { EthereumResetAllowanceTask } from './tasks/EthereumResetAllowanceTask.js'
import { EthereumSetAllowanceTask } from './tasks/EthereumSetAllowanceTask.js'
import { EthereumSignAndExecuteTask } from './tasks/EthereumSignAndExecuteTask.js'
import { EthereumWaitForTransactionStatusTask } from './tasks/EthereumWaitForTransactionStatusTask.js'
import { EthereumWaitForTransactionTask } from './tasks/EthereumWaitForTransactionTask.js'

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

type TaskClass = abstract new (...args: never[]) => object

// The order in which createPipeline builds the tasks.
const ETHEREUM_TASKS: TaskClass[] = [
  EthereumCheckPermitsTask,
  EthereumCheckAllowanceTask,
  EthereumNativePermitTask,
  EthereumResetAllowanceTask,
  EthereumSetAllowanceTask,
  EthereumCheckBalanceTask,
  EthereumPermit2AllowanceTask,
  EthereumPrepareTransactionTask,
  EthereumSignAndExecuteTask,
  EthereumWaitForTransactionTask,
  EthereumWaitForTransactionStatusTask,
]

const taskClasses = (pipeline: TaskPipeline): unknown[] =>
  (pipeline as unknown as { tasks: object[] }).tasks.map(
    (task) => task.constructor
  )

const tasksFrom = (first: TaskClass): TaskClass[] =>
  ETHEREUM_TASKS.slice(ETHEREUM_TASKS.indexOf(first))

const contextWithActions = (
  actions: object[],
  isBridgeExecution = false
): EthereumStepExecutorContext =>
  ({
    ...buildContext(),
    isBridgeExecution,
    step: { ...buildStep(), execution: { status: 'PENDING', actions } },
  }) as unknown as EthereumStepExecutorContext

// A minifier renames every module-local class binding on its own, so two
// classes can end up with the same `name`. Give all of them one
// name and return a function that restores the originals.
const giveEveryTaskClassTheSameName = (classes: TaskClass[]): (() => void) => {
  const originals = classes.map((taskClass) =>
    Object.getOwnPropertyDescriptor(taskClass, 'name')
  )
  for (const taskClass of classes) {
    Object.defineProperty(taskClass, 'name', { value: 'i', configurable: true })
  }
  return () => {
    for (const [index, taskClass] of classes.entries()) {
      const original = originals[index]
      if (original) {
        Object.defineProperty(taskClass, 'name', original)
      }
    }
  }
}

describe('EthereumStepExecutor.createPipeline when every task class has the same name', () => {
  let restoreNames: () => void = () => {}

  beforeEach(() => {
    restoreNames = giveEveryTaskClassTheSameName(ETHEREUM_TASKS)
  })

  afterEach(() => {
    restoreNames()
  })

  it('simulates the minifier collision', () => {
    expect(new Set(ETHEREUM_TASKS.map((taskClass) => taskClass.name))).toEqual(
      new Set(['i'])
    )
  })

  it('starts at EthereumCheckPermitsTask when an allowance check is needed', () => {
    expect(taskClasses(buildExecutor().createPipeline(buildContext()))).toEqual(
      tasksFrom(EthereumCheckPermitsTask)
    )
  })

  it('starts at EthereumCheckBalanceTask for a native token', () => {
    expect(
      taskClasses(
        buildExecutor().createPipeline(
          buildContext({ isFromNativeToken: true })
        )
      )
    ).toEqual(tasksFrom(EthereumCheckBalanceTask))
  })

  it('resumes at EthereumWaitForTransactionTask when a hash exists but the action is not DONE', () => {
    expect(
      taskClasses(
        buildExecutor().createPipeline(
          contextWithActions([
            { type: 'SWAP', status: 'PENDING', txHash: '0xabc' },
          ])
        )
      )
    ).toEqual(tasksFrom(EthereumWaitForTransactionTask))
  })

  it('resumes at EthereumWaitForTransactionTask for a relayer task id without a hash', () => {
    expect(
      taskClasses(
        buildExecutor().createPipeline(
          contextWithActions([
            { type: 'SWAP', status: 'PENDING', taskId: 'task-1' },
          ])
        )
      )
    ).toEqual(tasksFrom(EthereumWaitForTransactionTask))
  })

  it('resumes at EthereumWaitForTransactionStatusTask when the action is DONE', () => {
    expect(
      taskClasses(
        buildExecutor().createPipeline(
          contextWithActions([
            { type: 'SWAP', status: 'DONE', txHash: '0xabc' },
          ])
        )
      )
    ).toEqual(tasksFrom(EthereumWaitForTransactionStatusTask))
  })

  it('resumes a bridge at EthereumWaitForTransactionStatusTask when the CROSS_CHAIN action is DONE', () => {
    expect(
      taskClasses(
        buildExecutor().createPipeline(
          contextWithActions(
            [{ type: 'CROSS_CHAIN', status: 'DONE', txHash: '0xabc' }],
            true
          )
        )
      )
    ).toEqual(tasksFrom(EthereumWaitForTransactionStatusTask))
  })
})

// isFromNativeToken must stay gated on the zero address. Gas tokens with a
// real contract address (USDT0 on Stable, CELO, …) are pulled with
// transferFrom, so they need the allowance path.
describe('EthereumStepExecutor.createContext', () => {
  const STABLE_CHAIN = 988
  const STABLE_USDT0 = '0x779Ded0c9e1022225f8E0630b35a9b54bE713736'
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

  const baseContextFor = (
    nativeTokenAddress: string,
    fromTokenAddress: string
  ): StepExecutorBaseContext => {
    const step = buildStep()
    return {
      step: {
        ...step,
        action: {
          ...step.action,
          fromChainId: STABLE_CHAIN,
          fromToken: { address: fromTokenAddress, chainId: STABLE_CHAIN },
        },
      },
      fromChain: {
        id: STABLE_CHAIN,
        nativeToken: { address: nativeTokenAddress },
      },
    } as unknown as StepExecutorBaseContext
  }

  it('keeps the allowance path for a native gas token with a real address', async () => {
    const executor = buildExecutor()
    const context = await executor.createContext(
      baseContextFor(STABLE_USDT0, STABLE_USDT0)
    )

    expect(context.isFromNativeToken).toBe(false)
    expect(taskClasses(executor.createPipeline(context))[0]).toBe(
      EthereumCheckPermitsTask
    )
  })

  it('treats the zero-address native token as native', async () => {
    const executor = buildExecutor()
    const context = await executor.createContext(
      baseContextFor(ZERO_ADDRESS, ZERO_ADDRESS)
    )

    expect(context.isFromNativeToken).toBe(true)
    expect(taskClasses(executor.createPipeline(context))[0]).toBe(
      EthereumCheckBalanceTask
    )
  })
})
