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

import { signTypedData } from 'viem/actions'
import type { EthereumStepExecutorContext } from '../../types.js'
import { EthereumSignStepIntentTask } from './EthereumSignStepIntentTask.js'

const SOURCE_CHAIN = 1
const FROM_ADDRESS = '0xaaaa000000000000000000000000000000000001' as Address
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const UNIVERSAL_ROUTER = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af'
const SIGNATURE = `0x${'11'.repeat(65)}` as Hex

const permitSingle = (): TypedData =>
  ({
    primaryType: 'PermitSingle',
    domain: { chainId: SOURCE_CHAIN, verifyingContract: PERMIT2 },
    types: {},
    message: {
      details: {
        token: '0xcccc000000000000000000000000000000000003',
        amount: '1000000',
        expiration: 0,
        nonce: 0,
      },
      spender: UNIVERSAL_ROUTER,
      sigDeadline: String(Math.floor(Date.now() / 1000) + 3600),
    },
  }) as unknown as TypedData

const witness = (): TypedData =>
  ({
    primaryType: 'PermitWitnessTransferFrom',
    domain: { chainId: SOURCE_CHAIN, verifyingContract: PERMIT2 },
    types: {},
    message: {},
  }) as unknown as TypedData

const nativePermit = (): TypedData =>
  ({
    primaryType: 'Permit',
    domain: { chainId: SOURCE_CHAIN },
    types: {},
    message: {
      owner: FROM_ADDRESS,
      spender: '0xcccc000000000000000000000000000000000003',
      value: '1',
      deadline: '1',
    },
  }) as unknown as TypedData

const buildContext = (
  typedData: TypedData[] = [permitSingle()]
): EthereumStepExecutorContext =>
  ({
    step: {
      type: 'lifi',
      id: 'step-1',
      tool: 'uniswap',
      action: { fromChainId: SOURCE_CHAIN, fromAddress: FROM_ADDRESS },
      estimate: { approvalAddress: PERMIT2, gasCosts: [], feeCosts: [] },
      typedData,
    } as unknown as LiFiStep,
    fromChain: { id: SOURCE_CHAIN, permit2: PERMIT2 },
    disableMessageSigning: false,
    statusManager: {
      initializeAction: vi.fn().mockReturnValue({ type: 'PERMIT' }),
      updateAction: vi.fn(),
    },
    allowUserInteraction: true,
    checkClient: vi.fn().mockResolvedValue({
      account: { address: FROM_ADDRESS },
    }),
    signedTypedData: [],
  }) as unknown as EthereumStepExecutorContext

const task = new EthereumSignStepIntentTask()

beforeEach(() => {
  vi.clearAllMocks()
})

describe('EthereumSignStepIntentTask.shouldRun', () => {
  it('runs for a caller-supplied Permit2 intent', async () => {
    expect(await task.shouldRun(buildContext())).toBe(true)
  })

  it('does not run for a gasless witness intent, which the relayer task signs', async () => {
    expect(await task.shouldRun(buildContext([witness()]))).toBe(false)
  })

  it('does not run for a native permit, which EthereumCheckPermitsTask signs', async () => {
    expect(await task.shouldRun(buildContext([nativePermit()]))).toBe(false)
  })

  it('does not run for a mixed-lane step, which the relayer lane discards', async () => {
    // A step carrying both lanes goes to `getRelayerUpdatedStep`, which takes
    // no `signedTypedData` and re-quotes. Anything signed here is thrown away,
    // and a re-quote echoing the `PermitSingle` makes
    // `EthereumRelayedSignAndExecuteTask` prompt for it a second time.
    expect(
      await task.shouldRun(buildContext([witness(), permitSingle()]))
    ).toBe(false)
  })

  it('does not run when message signing is disabled', async () => {
    const context = buildContext()
    context.disableMessageSigning = true
    expect(await task.shouldRun(context)).toBe(false)
  })
})

describe('EthereumSignStepIntentTask.run', () => {
  it('signs the intent and puts it on the context for getStepTransaction', async () => {
    vi.mocked(signTypedData).mockResolvedValue(SIGNATURE)
    const context = buildContext()

    const result = await task.run(context)
    const resultContext = result.context as
      | { signedTypedData?: SignedTypedData[] }
      | undefined

    expect(result.status).toBe('COMPLETED')
    expect(resultContext?.signedTypedData).toHaveLength(1)
    expect(resultContext?.signedTypedData?.[0].primaryType).toBe('PermitSingle')
    expect(resultContext?.signedTypedData?.[0].signature).toBe(SIGNATURE)
  })

  it('signs only the caller-intent entries, leaving the other lanes alone', async () => {
    // A native permit, not a witness: `EthereumCheckPermitsTask` signs it, so
    // this task must skip it.
    vi.mocked(signTypedData).mockResolvedValue(SIGNATURE)
    const context = buildContext([nativePermit(), permitSingle()])

    const result = await task.run(context)
    const resultContext = result.context as
      | { signedTypedData?: SignedTypedData[] }
      | undefined

    expect(signTypedData).toHaveBeenCalledTimes(1)
    expect(resultContext?.signedTypedData).toHaveLength(1)
    expect(resultContext?.signedTypedData?.[0].primaryType).toBe('PermitSingle')
  })

  it('pauses instead of prompting when user interaction is not allowed', async () => {
    const context = buildContext()
    context.allowUserInteraction = false

    expect(await task.run(context)).toEqual({ status: 'PAUSED' })
    expect(signTypedData).not.toHaveBeenCalled()
  })

  it('throws SignatureRejected when the wallet resolves with null', async () => {
    vi.mocked(signTypedData).mockResolvedValue(null as unknown as Hex)

    await expect(task.run(buildContext())).rejects.toMatchObject({
      name: 'TransactionError',
      code: LiFiErrorCode.SignatureRejected,
    })
  })
})
