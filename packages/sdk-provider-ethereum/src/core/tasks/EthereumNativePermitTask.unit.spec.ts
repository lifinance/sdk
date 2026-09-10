import type { LiFiStep, SignedTypedData, TypedData } from '@lifi/sdk'
import type { Address, Hex } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../utils/getActionWithFallback.js', () => ({
  getActionWithFallback: vi.fn(),
}))

vi.mock('../../actions/isBatchingSupported.js', () => ({
  isBatchingSupported: vi.fn(),
}))

vi.mock('viem/actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem/actions')>()
  return {
    ...actual,
    signTypedData: vi.fn(),
  }
})

import { signTypedData } from 'viem/actions'
import { isBatchingSupported } from '../../actions/isBatchingSupported.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { getActionWithFallback } from '../../utils/getActionWithFallback.js'
import { EthereumNativePermitTask } from './EthereumNativePermitTask.js'

const SOURCE_CHAIN = 1
const FROM_ADDRESS = '0xaaaa000000000000000000000000000000000001' as Address
const TOKEN_ADDRESS = '0xcccc000000000000000000000000000000000003' as Address
const PERMIT2_PROXY = '0xdddd000000000000000000000000000000000004' as Address
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address
const UNIVERSAL_ROUTER = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af'
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

const buildCallerIntent = (): TypedData =>
  ({
    primaryType: 'PermitSingle',
    domain: { chainId: SOURCE_CHAIN },
    types: {},
    message: { spender: UNIVERSAL_ROUTER },
  }) as unknown as TypedData

const buildWitnessTypedData = (): TypedData =>
  ({
    primaryType: 'PermitWitnessTransferFrom',
    domain: { chainId: SOURCE_CHAIN },
    types: {},
    message: {},
  }) as unknown as TypedData

const buildStep = (typedData?: TypedData[]): LiFiStep =>
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
    ...(typedData ? { typedData } : {}),
  }) as unknown as LiFiStep

const buildContext = (overrides?: {
  signedTypedData?: SignedTypedData[]
  typedData?: TypedData[]
}): {
  context: EthereumStepExecutorContext
  updateAction: ReturnType<typeof vi.fn>
} => {
  const updateAction = vi.fn()
  const context = {
    step: buildStep(overrides?.typedData),
    client: {},
    fromChain: {
      id: SOURCE_CHAIN,
      permit2: PERMIT2,
      permit2Proxy: PERMIT2_PROXY,
    },
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
  vi.mocked(isBatchingSupported).mockResolvedValue(false)
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

describe('EthereumNativePermitTask.shouldRun', () => {
  it('does not mint a native permit when the caller supplied its own Permit2 intent', async () => {
    const { context } = buildContext({ typedData: [buildCallerIntent()] })

    expect(await task.shouldRun(context)).toBe(false)
    expect(context.checkClient).not.toHaveBeenCalled()
  })

  it('still mints a native permit for a step with no caller intent', async () => {
    const { context } = buildContext()

    expect(await task.shouldRun(context)).toBe(true)
  })

  it('still mints a native permit for a mixed-lane step', async () => {
    const { context } = buildContext({
      typedData: [buildWitnessTypedData(), buildCallerIntent()],
    })

    expect(await task.shouldRun(context)).toBe(true)
  })

  it('does not mint a native permit when the caller intent names Permit2 itself as verifyingContract', async () => {
    const intent = buildCallerIntent() as unknown as {
      domain: Record<string, unknown>
    }
    intent.domain = { chainId: SOURCE_CHAIN, verifyingContract: PERMIT2 }
    const { context } = buildContext({
      typedData: [intent as unknown as TypedData],
    })

    expect(await task.shouldRun(context)).toBe(false)
  })

  it('mints a native permit when the intent spender IS the Permit2 deployment, which makes it the relayer lane', async () => {
    const intent = buildCallerIntent() as unknown as {
      message: Record<string, unknown>
    }
    intent.message = { spender: PERMIT2 }
    const { context } = buildContext({
      typedData: [intent as unknown as TypedData],
    })

    expect(await task.shouldRun(context)).toBe(true)
  })
})
