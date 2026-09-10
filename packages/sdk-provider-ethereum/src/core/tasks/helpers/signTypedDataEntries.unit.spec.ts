import type { LiFiStep, SignedTypedData, TypedData } from '@lifi/sdk'
import type { Address, Hex } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('viem/actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem/actions')>()
  return {
    ...actual,
    signTypedData: vi.fn(),
  }
})

import { signTypedData } from 'viem/actions'
import type { EthereumStepExecutorContext } from '../../../types.js'
import { signTypedDataEntries } from './signTypedDataEntries.js'

const SOURCE_CHAIN = 1
const OTHER_CHAIN = 137
const FROM_ADDRESS = '0xaaaa000000000000000000000000000000000001' as Address
const SIGNATURE = `0x${'11'.repeat(65)}` as Hex
const EXISTING_SIGNATURE = `0x${'22'.repeat(65)}` as Hex

const entry = (chainId?: number): TypedData =>
  ({
    primaryType: 'Permit',
    domain: chainId ? { chainId } : {},
    types: {},
    message: { owner: FROM_ADDRESS },
  }) as unknown as TypedData

const existingSigned = (): SignedTypedData =>
  ({ ...entry(SOURCE_CHAIN), signature: EXISTING_SIGNATURE }) as SignedTypedData

const buildContext = (options?: {
  allowUserInteraction?: boolean
  signedTypedData?: SignedTypedData[]
}): EthereumStepExecutorContext =>
  ({
    step: {
      type: 'lifi',
      id: 'step-1',
      action: { fromChainId: SOURCE_CHAIN, fromAddress: FROM_ADDRESS },
      estimate: {},
    } as unknown as LiFiStep,
    statusManager: {
      updateAction: vi.fn(),
    },
    allowUserInteraction: options?.allowUserInteraction ?? true,
    // The client stub must not carry its own signTypedData method so getAction
    // falls through to the mocked viem action.
    checkClient: vi.fn().mockResolvedValue({
      account: { address: FROM_ADDRESS },
    }),
    signedTypedData: options?.signedTypedData ?? [],
  }) as unknown as EthereumStepExecutorContext

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(signTypedData).mockResolvedValue(SIGNATURE)
})

describe('signTypedDataEntries', () => {
  it('signs each entry and appends to a COPY of context.signedTypedData', async () => {
    const context = buildContext({ signedTypedData: [existingSigned()] })

    const result = await signTypedDataEntries(
      context,
      [entry(SOURCE_CHAIN), entry(SOURCE_CHAIN)],
      'PERMIT'
    )

    expect(result.status).toBe('COMPLETED')
    if (result.status !== 'COMPLETED') {
      return
    }
    expect(result.signedTypedData).toHaveLength(3)
    expect(result.signedTypedData[0].signature).toBe(EXISTING_SIGNATURE)
    expect(result.signedTypedData[1].signature).toBe(SIGNATURE)
    // The context array is the task's input and must survive untouched: a task
    // that pauses mid-way must not leave half a signature set behind.
    expect(context.signedTypedData).toHaveLength(1)
    expect(result.signedTypedData).not.toBe(context.signedTypedData)
  })

  it('switches chain per entry using the entry own domain.chainId', async () => {
    const context = buildContext()

    await signTypedDataEntries(
      context,
      [entry(SOURCE_CHAIN), entry(OTHER_CHAIN)],
      'PERMIT'
    )

    expect(context.checkClient).toHaveBeenNthCalledWith(
      1,
      context.step,
      SOURCE_CHAIN
    )
    expect(context.checkClient).toHaveBeenNthCalledWith(
      2,
      context.step,
      OTHER_CHAIN
    )
  })

  it('falls back to step.action.fromChainId when the domain has no chain id', async () => {
    const context = buildContext()

    await signTypedDataEntries(context, [entry()], 'PERMIT')

    expect(context.checkClient).toHaveBeenCalledWith(context.step, SOURCE_CHAIN)
  })

  it('returns PAUSED when allowUserInteraction is false', async () => {
    const context = buildContext({ allowUserInteraction: false })

    const result = await signTypedDataEntries(
      context,
      [entry(SOURCE_CHAIN)],
      'PERMIT'
    )

    expect(result).toEqual({ status: 'PAUSED' })
    expect(signTypedData).not.toHaveBeenCalled()
  })

  it('returns PAUSED when checkClient resolves undefined mid-loop', async () => {
    const context = buildContext()
    vi.mocked(context.checkClient)
      .mockResolvedValueOnce({ account: { address: FROM_ADDRESS } } as never)
      .mockResolvedValueOnce(undefined)

    const result = await signTypedDataEntries(
      context,
      [entry(SOURCE_CHAIN), entry(OTHER_CHAIN)],
      'PERMIT'
    )

    expect(result).toEqual({ status: 'PAUSED' })
    expect(signTypedData).toHaveBeenCalledTimes(1)
  })

  it('emits the status passed by the caller', async () => {
    // `EthereumRelayedSignAndExecuteTask` needs MESSAGE_REQUIRED, the other two
    // callers need the ACTION_REQUIRED default.
    const context = buildContext()

    await signTypedDataEntries(
      context,
      [entry(SOURCE_CHAIN)],
      'SWAP',
      'MESSAGE_REQUIRED'
    )
    expect(context.statusManager.updateAction).toHaveBeenCalledWith(
      context.step,
      'SWAP',
      'MESSAGE_REQUIRED'
    )

    const defaultContext = buildContext()
    await signTypedDataEntries(defaultContext, [entry(SOURCE_CHAIN)], 'PERMIT')
    expect(defaultContext.statusManager.updateAction).toHaveBeenCalledWith(
      defaultContext.step,
      'PERMIT',
      'ACTION_REQUIRED'
    )
  })
})
