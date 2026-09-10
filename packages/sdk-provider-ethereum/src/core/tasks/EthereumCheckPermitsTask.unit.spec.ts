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
import { EthereumCheckPermitsTask } from './EthereumCheckPermitsTask.js'

const SOURCE_CHAIN = 1
const FROM_ADDRESS = '0xaaaa000000000000000000000000000000000001' as Address
const SIGNATURE = `0x${'11'.repeat(65)}` as Hex

const buildPermitTypedData = (): TypedData =>
  ({
    primaryType: 'Permit',
    domain: { chainId: SOURCE_CHAIN },
    types: {},
    message: {
      owner: FROM_ADDRESS,
      spender: '0xbbbb000000000000000000000000000000000002',
      value: '1000000',
      nonce: '0',
      deadline: String(Math.floor(Date.now() / 1000) + 3600),
    },
  }) as TypedData

const buildPermitSingleTypedData = (): TypedData =>
  ({
    primaryType: 'PermitSingle',
    domain: { chainId: SOURCE_CHAIN },
    types: {},
    message: {
      details: { token: '0xcccc000000000000000000000000000000000003' },
      spender: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af',
      sigDeadline: String(Math.floor(Date.now() / 1000) + 3600),
    },
  }) as unknown as TypedData

const buildWitnessTypedData = (): TypedData =>
  ({
    primaryType: 'PermitWitnessTransferFrom',
    domain: { chainId: SOURCE_CHAIN },
    types: {},
    message: {},
  }) as unknown as TypedData

const buildContext = (
  typedData: TypedData[] = [buildPermitTypedData()]
): EthereumStepExecutorContext => {
  const step = {
    type: 'lifi',
    id: 'step-1',
    tool: 'lifi',
    action: { fromChainId: SOURCE_CHAIN, fromAddress: FROM_ADDRESS },
    estimate: { gasCosts: [], feeCosts: [] },
    typedData,
  } as unknown as LiFiStep
  return {
    step,
    fromChain: {
      id: SOURCE_CHAIN,
      permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    },
    statusManager: {
      initializeAction: vi.fn().mockReturnValue({ type: 'PERMIT' }),
      updateAction: vi.fn(),
    },
    allowUserInteraction: true,
    checkClient: vi.fn().mockResolvedValue({
      account: { address: FROM_ADDRESS },
    }),
    signedTypedData: [],
  } as unknown as EthereumStepExecutorContext
}

const task = new EthereumCheckPermitsTask()

beforeEach(() => {
  vi.clearAllMocks()
})

describe('EthereumCheckPermitsTask.run', () => {
  it('throws SignatureRejected when the wallet resolves signTypedData with null', async () => {
    vi.mocked(signTypedData).mockResolvedValue(null as unknown as Hex)
    const context = buildContext()

    await expect(task.run(context)).rejects.toMatchObject({
      name: 'TransactionError',
      code: LiFiErrorCode.SignatureRejected,
    })
    expect(context.signedTypedData).toHaveLength(0)
  })

  it('stores the signed permit and sets hasMatchingPermit for a valid signature', async () => {
    vi.mocked(signTypedData).mockResolvedValue(SIGNATURE)
    const context = buildContext()

    const result = await task.run(context)
    const resultContext = result.context as
      | { hasMatchingPermit?: boolean; signedTypedData?: SignedTypedData[] }
      | undefined

    expect(result.status).toBe('COMPLETED')
    expect(resultContext?.hasMatchingPermit).toBe(true)
    expect(resultContext?.signedTypedData?.[0].signature).toBe(SIGNATURE)
  })

  it('does not run for a caller-supplied Permit2 intent, which the intent task signs', async () => {
    const context = buildContext([buildPermitSingleTypedData()])
    expect(await task.shouldRun(context)).toBe(false)
  })

  it('keeps hasMatchingPermit for a mixed-lane step, which the relayer funds', async () => {
    // The lanes are NOT mutually exclusive. A witness intent beside the caller
    // intent means the relayer pulls the tokens through Permit2, so the gate
    // stays on, the spender stays `fromChain.permit2` and the native permit
    // does cover it. Clearing the flag here would make
    // `EthereumSetAllowanceTask` eligible and ask a gasless user to send and
    // fund an approval.
    vi.mocked(signTypedData).mockResolvedValue(SIGNATURE)
    const context = buildContext([
      buildWitnessTypedData(),
      buildPermitSingleTypedData(),
      buildPermitTypedData(),
    ])

    const result = await task.run(context)
    const resultContext = result.context as
      | { hasMatchingPermit?: boolean }
      | undefined

    expect(resultContext?.hasMatchingPermit).toBe(true)
  })

  it('keeps hasMatchingPermit for a native + relayer step', async () => {
    vi.mocked(signTypedData).mockResolvedValue(SIGNATURE)
    const context = buildContext([
      buildPermitTypedData(),
      buildWitnessTypedData(),
    ])

    const result = await task.run(context)
    const resultContext = result.context as
      | { hasMatchingPermit?: boolean }
      | undefined

    expect(resultContext?.hasMatchingPermit).toBe(true)
  })

  it('clears hasMatchingPermit when a caller intent also needs the allowance', async () => {
    // A native permit's spender is fromChain.permit2Proxy. It satisfies nothing
    // a third-party Permit2 intent needs, so the token -> Permit2 approval must
    // still run.
    vi.mocked(signTypedData).mockResolvedValue(SIGNATURE)
    const context = buildContext([
      buildPermitTypedData(),
      buildPermitSingleTypedData(),
    ])

    const result = await task.run(context)
    const resultContext = result.context as
      | { hasMatchingPermit?: boolean; signedTypedData?: SignedTypedData[] }
      | undefined

    expect(resultContext?.signedTypedData).toHaveLength(1)
    expect(resultContext?.signedTypedData?.[0].primaryType).toBe('Permit')
    expect(resultContext?.hasMatchingPermit).toBe(false)
  })
})
