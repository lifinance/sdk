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

/** A native permit `EthereumCheckPermitsTask` signs before this task runs. */
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

/** The same permit with a signature, so `isNativePermitValid` accepts it. */
const signedNativePermit = (): SignedTypedData =>
  ({
    ...nativePermit(),
    signature: EXISTING_SIGNATURE,
  }) as unknown as SignedTypedData

/**
 * The gasless intent the relayer submits. The dedupe filter never removes it.
 */
const witness = (): TypedData =>
  ({
    primaryType: 'PermitWitnessTransferFrom',
    domain: { chainId: SOURCE_CHAIN },
    types: {},
    message: {},
  }) as unknown as TypedData

const buildContext = (options?: {
  typedData?: TypedData[]
  signedTypedData?: SignedTypedData[]
  allowUserInteraction?: boolean
}): EthereumStepExecutorContext =>
  ({
    step: {
      type: 'lifi',
      id: 'step-1',
      // Not `hyperliquidSpotProtocol`, so `isHyperliquidAgentStep` is false
      // and the task takes the shared signing loop.
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
    // The client stub must not carry its own signTypedData method so getAction
    // falls through to the mocked viem action.
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
    // The shipped gasless path. `MESSAGE_REQUIRED` is what the widget renders
    // as "sign a message" — see `signTypedDataEntries.unit.spec.ts`.
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
    // A permit signed earlier in the same execution must not be re-prompted,
    // and the witness intent beside it must still be signed.
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
    // The status is emitted before the interaction check, so the widget can
    // show what the paused step is waiting for.
    expect(context.statusManager.updateAction).toHaveBeenCalledWith(
      context.step,
      'SWAP',
      'MESSAGE_REQUIRED'
    )
    expect(signTypedData).not.toHaveBeenCalled()
    expect(relayTransaction).not.toHaveBeenCalled()
  })
})
