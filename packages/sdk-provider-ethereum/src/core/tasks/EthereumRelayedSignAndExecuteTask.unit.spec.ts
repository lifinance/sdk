import {
  LiFiErrorCode,
  type LiFiStep,
  type SignedTypedData,
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

import { relayTransaction } from '@lifi/sdk'
import { signTypedData } from 'viem/actions'
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

const callerIntent = (): TypedData =>
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

const signedCallerIntent = (): SignedTypedData =>
  ({
    ...callerIntent(),
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

  it('relays a caller intent it already holds without asking again', async () => {
    const context = buildContext({
      typedData: [callerIntent()],
      signedTypedData: [signedCallerIntent()],
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
      typedData: [callerIntent(), witness()],
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
