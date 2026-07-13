import type { LiFiStep, SignedTypedData, TypedData } from '@lifi/sdk'
import type { Address, Hex } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../utils/getActionWithFallback.js', () => ({
  getActionWithFallback: vi.fn(),
}))

vi.mock('viem/actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem/actions')>()
  return {
    ...actual,
    signTypedData: vi.fn(),
  }
})

import { signTypedData } from 'viem/actions'
import type { EthereumStepExecutorContext } from '../../types.js'
import { getActionWithFallback } from '../../utils/getActionWithFallback.js'
import { EthereumNativePermitTask } from './EthereumNativePermitTask.js'

const SOURCE_CHAIN = 1
const FROM_ADDRESS = '0xaaaa000000000000000000000000000000000001' as Address
const TOKEN_ADDRESS = '0xcccc000000000000000000000000000000000003' as Address
const PERMIT2_PROXY = '0xdddd000000000000000000000000000000000004' as Address
const SIGNATURE = `0x${'11'.repeat(65)}` as Hex

const buildNativePermitData = (): TypedData =>
  ({
    primaryType: 'Permit',
    domain: {
      name: 'USD Coin',
      version: '2',
      chainId: SOURCE_CHAIN,
      verifyingContract: TOKEN_ADDRESS,
    },
    types: {},
    message: {
      owner: FROM_ADDRESS,
      spender: PERMIT2_PROXY,
      value: '1000000',
      nonce: '0',
      deadline: String(Math.floor(Date.now() / 1000) + 3600),
    },
  }) as TypedData

const buildStep = (): LiFiStep =>
  ({
    type: 'lifi',
    id: 'step-1',
    tool: 'lifi',
    action: {
      fromChainId: SOURCE_CHAIN,
      fromAddress: FROM_ADDRESS,
      fromAmount: '1000000',
      fromToken: { address: TOKEN_ADDRESS, chainId: SOURCE_CHAIN },
    },
    estimate: { gasCosts: [], feeCosts: [] },
  }) as unknown as LiFiStep

const buildContext = (overrides?: {
  signedTypedData?: SignedTypedData[]
}): {
  context: EthereumStepExecutorContext
  updateAction: ReturnType<typeof vi.fn>
} => {
  const updateAction = vi.fn()
  const context = {
    step: buildStep(),
    client: {},
    fromChain: { id: SOURCE_CHAIN, permit2Proxy: PERMIT2_PROXY },
    statusManager: {
      initializeAction: vi.fn().mockReturnValue({ type: 'NATIVE_PERMIT' }),
      updateAction,
    },
    allowUserInteraction: true,
    // The client stub must not carry its own signTypedData method so
    // getAction falls through to the mocked viem action
    checkClient: vi.fn().mockResolvedValue({
      account: { address: FROM_ADDRESS },
    }),
    signedTypedData: overrides?.signedTypedData ?? [],
  } as unknown as EthereumStepExecutorContext
  return { context, updateAction }
}

type PermitTaskContext =
  | {
      hasMatchingPermit?: boolean
      signedTypedData?: SignedTypedData[]
    }
  | undefined

const task = new EthereumNativePermitTask()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getActionWithFallback).mockResolvedValue(buildNativePermitData())
})

describe('EthereumNativePermitTask.run', () => {
  it('falls back to the approval flow when the wallet resolves signTypedData with null (issue #424)', async () => {
    vi.mocked(signTypedData).mockResolvedValue(null as unknown as Hex)
    const { context, updateAction } = buildContext()

    const result = await task.run(context)

    // Completes without claiming a permit so ResetAllowance/SetAllowance run
    expect(result.status).toBe('COMPLETED')
    expect(result.context).toBeUndefined()
    expect(context.signedTypedData).toHaveLength(0)
    expect(updateAction).toHaveBeenLastCalledWith(
      context.step,
      'NATIVE_PERMIT',
      'DONE'
    )
  })

  it('stores the permit and sets hasMatchingPermit for a valid signature', async () => {
    vi.mocked(signTypedData).mockResolvedValue(SIGNATURE)
    const { context } = buildContext()

    const result = await task.run(context)
    const resultContext = result.context as PermitTaskContext

    expect(result.status).toBe('COMPLETED')
    expect(resultContext?.hasMatchingPermit).toBe(true)
    expect(resultContext?.signedTypedData).toHaveLength(1)
    expect(resultContext?.signedTypedData?.[0].signature).toBe(SIGNATURE)
  })

  it('skips signing when a valid matching permit already exists', async () => {
    const existingPermit: SignedTypedData = {
      ...buildNativePermitData(),
      signature: SIGNATURE,
    }
    const { context } = buildContext({ signedTypedData: [existingPermit] })

    const result = await task.run(context)
    const resultContext = result.context as PermitTaskContext

    expect(signTypedData).not.toHaveBeenCalled()
    expect(resultContext?.hasMatchingPermit).toBe(true)
    expect(resultContext?.signedTypedData).toHaveLength(1)
  })

  it('re-signs when an existing matching permit has a nullish signature', async () => {
    vi.mocked(signTypedData).mockResolvedValue(SIGNATURE)
    const stalePermit: SignedTypedData = {
      ...buildNativePermitData(),
      signature: null as unknown as Hex,
    }
    const { context } = buildContext({ signedTypedData: [stalePermit] })

    const result = await task.run(context)
    const resultContext = result.context as PermitTaskContext

    expect(signTypedData).toHaveBeenCalledTimes(1)
    expect(resultContext?.hasMatchingPermit).toBe(true)
    expect(
      resultContext?.signedTypedData?.filter((item) => item.signature)
    ).toHaveLength(1)
  })
})
