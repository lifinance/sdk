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

// A Permit2 PermitSingle for a non-LI.FI spender (e.g. Uniswap's router):
// not a native permit, not gasless — must be signed inline so it can be
// embedded into the step's own transaction by getStepTransaction.
const buildPermitSingleTypedData = (): TypedData =>
  ({
    primaryType: 'PermitSingle',
    domain: { chainId: SOURCE_CHAIN },
    types: {},
    message: {
      details: { token: '0xcccc000000000000000000000000000000000003' },
      spender: '0xdddd000000000000000000000000000000000004',
      sigDeadline: String(Math.floor(Date.now() / 1000) + 3600),
    },
  }) as unknown as TypedData

// A LI.FI relayer intent — signed by the relayer sign task, NOT here.
const buildWitnessTypedData = (): TypedData =>
  ({
    primaryType: 'PermitWitnessTransferFrom',
    domain: { chainId: SOURCE_CHAIN },
    types: {},
    message: { spender: '0xeeee000000000000000000000000000000000005' },
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
    fromChain: { id: SOURCE_CHAIN } as unknown,
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

  it('signs a non-gasless PermitSingle inline (non-LI.FI spender)', async () => {
    vi.mocked(signTypedData).mockResolvedValue(SIGNATURE)
    const context = buildContext([buildPermitSingleTypedData()])

    expect(await task.shouldRun(context)).toBe(true)

    const result = await task.run(context)
    const resultContext = result.context as
      | { hasMatchingPermit?: boolean; signedTypedData?: SignedTypedData[] }
      | undefined
    expect(resultContext?.signedTypedData?.[0].signature).toBe(SIGNATURE)
    expect(resultContext?.signedTypedData?.[0].primaryType).toBe('PermitSingle')
    // A Permit2 PermitSingle is not a native permit: it must NOT suppress the
    // ERC-20 allowance check (the token → Permit2 approval is still needed).
    expect(resultContext?.hasMatchingPermit).toBe(false)
  })

  it('does not sign a gasless witness intent here (left to the relayer task)', async () => {
    const context = buildContext([buildWitnessTypedData()])
    expect(await task.shouldRun(context)).toBe(false)
  })
})
