import {
  LiFiErrorCode,
  type LiFiStep,
  type SignedTypedData,
  StatusManager,
  type TypedData,
} from '@lifi/sdk'
import type { Address, Hex } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('viem/actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem/actions')>()
  return {
    ...actual,
    signTypedData: vi.fn(),
  }
})

vi.mock('@lifi/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lifi/sdk')>()
  return {
    ...actual,
    relayTransaction: vi.fn(),
  }
})

vi.mock('../../hyperliquid/agentWallet.js', () => ({
  getOrCreateAgentWallet: vi.fn(),
}))

import { relayTransaction } from '@lifi/sdk'
import { signTypedData } from 'viem/actions'
import { getOrCreateAgentWallet } from '../../hyperliquid/agentWallet.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { EthereumRelayedSignAndExecuteTask } from './EthereumRelayedSignAndExecuteTask.js'

const SOURCE_CHAIN = 1
const FROM_ADDRESS = '0xaaaa000000000000000000000000000000000001' as Address
const PERMIT2_PROXY = '0xdddd000000000000000000000000000000000004' as Address
const SIGNATURE = `0x${'11'.repeat(65)}` as Hex
const EXISTING_SIGNATURE = `0x${'22'.repeat(65)}` as Hex
const TASK_ID = `0x${'ab'.repeat(32)}` as Hex

const nativePermit = (): TypedData =>
  ({
    primaryType: 'Permit',
    domain: { chainId: SOURCE_CHAIN },
    types: {},
    message: {
      owner: FROM_ADDRESS,
      spender: PERMIT2_PROXY,
      value: '1000000',
      nonce: '0',
      deadline: String(Math.floor(Date.now() / 1000) + 3600),
    },
  }) as unknown as TypedData

const signedNativePermit = (): SignedTypedData =>
  ({
    ...nativePermit(),
    signature: EXISTING_SIGNATURE,
  }) as unknown as SignedTypedData

const witness = (): TypedData =>
  ({
    primaryType: 'PermitWitnessTransferFrom',
    domain: { chainId: SOURCE_CHAIN },
    types: {},
    message: {},
  }) as unknown as TypedData

const THIRD_PARTY_ROUTER =
  '0xeeee000000000000000000000000000000000005' as Address

const permit2Allowance = (): TypedData =>
  ({
    primaryType: 'PermitSingle',
    domain: { name: 'Permit2', chainId: SOURCE_CHAIN },
    types: {},
    message: {
      details: {
        token: PERMIT2_PROXY,
        amount: '1000000',
        expiration: '1900000000',
        nonce: '0',
      },
      spender: THIRD_PARTY_ROUTER,
      sigDeadline: '1900000000',
    },
  }) as unknown as TypedData

const signedPermit2Allowance = (): SignedTypedData =>
  ({
    ...permit2Allowance(),
    signature: EXISTING_SIGNATURE,
  }) as unknown as SignedTypedData

const buildContext = (options?: {
  typedData?: TypedData[]
  signedTypedData?: SignedTypedData[]
  allowUserInteraction?: boolean
}): EthereumStepExecutorContext =>
  ({
    step: {
      type: 'lifi',
      id: 'step-1',
      tool: 'relay',
      action: { fromChainId: SOURCE_CHAIN, fromAddress: FROM_ADDRESS },
      estimate: { gasCosts: [], feeCosts: [] },
      typedData: options?.typedData ?? [witness()],
    } as unknown as LiFiStep,
    client: {},
    isBridgeExecution: false,
    allowUserInteraction: options?.allowUserInteraction ?? true,
    statusManager: {
      findAction: vi.fn().mockReturnValue({ type: 'SWAP' }),
      updateAction: vi.fn(),
    },
    checkClient: vi.fn().mockResolvedValue({
      account: { address: FROM_ADDRESS },
    }),
    signedTypedData: options?.signedTypedData ?? [],
  }) as unknown as EthereumStepExecutorContext

const task = new EthereumRelayedSignAndExecuteTask()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(signTypedData).mockResolvedValue(SIGNATURE)
  vi.mocked(relayTransaction).mockResolvedValue({
    taskId: TASK_ID,
    txLink: 'https://example.invalid/task',
  } as never)
})

describe('EthereumRelayedSignAndExecuteTask.run', () => {
  it('emits MESSAGE_REQUIRED before asking the wallet for a signature', async () => {
    const context = buildContext()

    const result = await task.run(context)

    expect(result.status).toBe('COMPLETED')
    expect(context.statusManager.updateAction).toHaveBeenNthCalledWith(
      1,
      context.step,
      'SWAP',
      'MESSAGE_REQUIRED'
    )
    expect(signTypedData).toHaveBeenCalledTimes(1)
    expect(relayTransaction).toHaveBeenCalledTimes(1)
  })

  it('signs each unsigned entry and skips one already signed', async () => {
    const context = buildContext({
      typedData: [nativePermit(), witness()],
      signedTypedData: [signedNativePermit()],
    })

    const result = await task.run(context)

    expect(signTypedData).toHaveBeenCalledTimes(1)
    expect(relayTransaction).toHaveBeenCalledWith(
      context.client,
      expect.objectContaining({
        typedData: [
          expect.objectContaining({
            primaryType: 'Permit',
            signature: EXISTING_SIGNATURE,
          }),
          expect.objectContaining({
            primaryType: 'PermitWitnessTransferFrom',
            signature: SIGNATURE,
          }),
        ],
      })
    )
    expect(result.status).toBe('COMPLETED')
  })

  it('relays a Permit2 allowance it already holds without asking again', async () => {
    const context = buildContext({
      typedData: [permit2Allowance()],
      signedTypedData: [signedPermit2Allowance()],
    })

    const result = await task.run(context)

    expect(signTypedData).not.toHaveBeenCalled()
    expect(context.statusManager.updateAction).not.toHaveBeenCalledWith(
      context.step,
      'SWAP',
      'MESSAGE_REQUIRED'
    )
    expect(relayTransaction).toHaveBeenCalledWith(
      context.client,
      expect.objectContaining({
        typedData: [
          expect.objectContaining({
            primaryType: 'PermitSingle',
            signature: EXISTING_SIGNATURE,
          }),
        ],
      })
    )
    expect(result.status).toBe('COMPLETED')
  })

  it('signs every entry when none of them is signed yet', async () => {
    const context = buildContext({
      typedData: [permit2Allowance(), witness()],
      signedTypedData: [],
    })

    await task.run(context)

    expect(signTypedData).toHaveBeenCalledTimes(2)
    expect(relayTransaction).toHaveBeenCalledWith(
      context.client,
      expect.objectContaining({
        typedData: [
          expect.objectContaining({
            primaryType: 'PermitSingle',
            signature: SIGNATURE,
          }),
          expect.objectContaining({
            primaryType: 'PermitWitnessTransferFrom',
            signature: SIGNATURE,
          }),
        ],
      })
    )
  })

  it('throws TransactionUnprepared when every entry is already signed', async () => {
    const context = buildContext({
      typedData: [nativePermit()],
      signedTypedData: [signedNativePermit()],
    })

    await expect(task.run(context)).rejects.toMatchObject({
      name: 'TransactionError',
      code: LiFiErrorCode.TransactionUnprepared,
      message:
        'Unable to prepare transaction. Typed data for transfer is not found.',
    })
    expect(relayTransaction).not.toHaveBeenCalled()
  })

  it('returns PAUSED when allowUserInteraction is false', async () => {
    const context = buildContext({ allowUserInteraction: false })

    expect(await task.run(context)).toEqual({ status: 'PAUSED' })
    expect(context.statusManager.updateAction).toHaveBeenCalledWith(
      context.step,
      'SWAP',
      'MESSAGE_REQUIRED'
    )
    expect(signTypedData).not.toHaveBeenCalled()
    expect(relayTransaction).not.toHaveBeenCalled()
  })
})

describe('EthereumRelayedSignAndExecuteTask.run transaction fields', () => {
  it('clears the previous transaction fields when it writes the task id', async () => {
    const context = buildContext()

    await task.run(context)

    const params = vi
      .mocked(context.statusManager.updateAction)
      .mock.calls.find(
        ([, , status, update]) => status === 'PENDING' && !!update?.taskId
      )?.[3]
    expect(Object.keys(params ?? {})).toEqual(
      expect.arrayContaining(['txHash', 'txLink', 'txHex', 'txFinal'])
    )
    expect(params).toMatchObject({
      taskId: TASK_ID,
      txType: 'relayed',
      txLink: 'https://example.invalid/task',
    })
    expect(params?.txHash).toBeUndefined()
    expect(params?.txFinal).toBeUndefined()
  })
})

describe('EthereumRelayedSignAndExecuteTask.run second pre-sign guard', () => {
  /** What an older run's late write merges into this action. */
  const mergeOpenTransaction = (context: EthereumStepExecutorContext): void => {
    vi.mocked(context.statusManager.findAction).mockReturnValue({
      type: 'SWAP',
      status: 'MESSAGE_REQUIRED',
      taskId: `0x${'01'.repeat(32)}`,
    } as never)
  }

  // An older run's late write can merge its transaction into this action
  // during any await before a signature. The
  // chain check of each entry is the last one.
  it('checks the action again right before signTypedData and never calls it when a transaction merged meanwhile', async () => {
    const context = buildContext()
    vi.mocked(context.checkClient).mockImplementationOnce(async () => {
      mergeOpenTransaction(context)
      return { account: { address: FROM_ADDRESS } } as never
    })

    await expect(task.run(context)).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionConflict,
    })
    expect(context.checkClient).toHaveBeenCalledTimes(1)
    expect(signTypedData).not.toHaveBeenCalled()
    expect(relayTransaction).not.toHaveBeenCalled()
  })

  it('checks the action again right before a Hyperliquid signature and never asks for it when a transaction merged meanwhile', async () => {
    const agentSignTypedData = vi.fn()
    vi.mocked(getOrCreateAgentWallet).mockResolvedValue({
      account: { address: FROM_ADDRESS, signTypedData: agentSignTypedData },
      needsApproval: true,
      expiresAt: 1_900_000_000_000,
    } as never)
    const base = buildContext()
    const context = {
      ...base,
      step: {
        ...base.step,
        tool: 'hyperliquidSpotProtocol',
        typedData: [
          {
            primaryType: 'HyperliquidTransaction:ApproveAgent',
            domain: { chainId: SOURCE_CHAIN },
            types: {},
            message: { agentAddress: FROM_ADDRESS, agentName: 'lifi' },
          },
          {
            primaryType: 'Agent',
            domain: { chainId: 1337 },
            types: {},
            message: { source: 'a', connectionId: `0x${'cc'.repeat(32)}` },
          },
        ],
      },
      fromChain: { id: SOURCE_CHAIN },
      ethereumClient: { account: { address: FROM_ADDRESS } },
      getStorage: () => ({}),
    } as unknown as EthereumStepExecutorContext
    vi.mocked(context.checkClient).mockImplementationOnce(async () => {
      mergeOpenTransaction(context)
      return { account: { address: FROM_ADDRESS } } as never
    })

    await expect(task.run(context)).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionConflict,
    })
    expect(context.checkClient).toHaveBeenCalledTimes(1)
    expect(signTypedData).not.toHaveBeenCalled()
    expect(agentSignTypedData).not.toHaveBeenCalled()
    expect(relayTransaction).not.toHaveBeenCalled()
  })
})

describe('EthereumRelayedSignAndExecuteTask.run check before the relay', () => {
  const MERGED_TASK_ID = `0x${'01'.repeat(32)}` as Hex
  const MERGED_SIGNED_AT = 1_800_000_000_000

  /**
   * The task on a real `StatusManager` and a step with a SWAP action. Without
   * route state, `allowUpdates(false)` keeps every write on the step.
   */
  const buildRealContext = (
    options?: Parameters<typeof buildContext>[0]
  ): EthereumStepExecutorContext => {
    const statusManager = new StatusManager('route-1')
    statusManager.allowUpdates(false)
    const base = buildContext(options)
    return {
      ...base,
      step: {
        ...base.step,
        execution: {
          status: 'PENDING',
          actions: [{ type: 'SWAP', status: 'STARTED' }],
        },
      },
      statusManager,
    } as unknown as EthereumStepExecutorContext
  }

  /** What the late write of an older, stopped run merges into the action. */
  const mergeLateWrite = (context: EthereumStepExecutorContext): void => {
    context.statusManager.updateAction(context.step, 'SWAP', 'PENDING', {
      taskId: MERGED_TASK_ID,
      txType: 'relayed',
      txLink: 'https://example.invalid/merged',
      signedAt: MERGED_SIGNED_AT,
    })
  }

  const expectMergedTaskKept = (context: EthereumStepExecutorContext): void => {
    expect(context.step.execution?.actions).toEqual([
      expect.objectContaining({
        type: 'SWAP',
        taskId: MERGED_TASK_ID,
        txType: 'relayed',
        txLink: 'https://example.invalid/merged',
      }),
    ])
    expect(context.step.execution?.signedAt).toBe(MERGED_SIGNED_AT)
  }

  // A stop during this run's prompt, then a resume: the older run relays
  // while the newer prompt is open, and its late write merges the task id.
  it('never relays when a task id merged while the wallet prompt was open', async () => {
    const context = buildRealContext()
    vi.mocked(signTypedData).mockImplementationOnce(async () => {
      mergeLateWrite(context)
      return SIGNATURE
    })

    await expect(task.run(context)).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionConflict,
    })
    expect(signTypedData).toHaveBeenCalledTimes(1)
    expect(relayTransaction).not.toHaveBeenCalled()
    expectMergedTaskKept(context)
  })

  // Every entry signed already: no prompt runs a check, so only the one
  // before the relay sees a task id merged during an earlier await.
  it('never relays signatures it already holds when a task id merged meanwhile', async () => {
    const context = buildRealContext({
      typedData: [permit2Allowance()],
      signedTypedData: [signedPermit2Allowance()],
    })
    mergeLateWrite(context)

    await expect(task.run(context)).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionConflict,
    })
    expect(signTypedData).not.toHaveBeenCalled()
    expect(relayTransaction).not.toHaveBeenCalled()
    expectMergedTaskKept(context)
  })
})
