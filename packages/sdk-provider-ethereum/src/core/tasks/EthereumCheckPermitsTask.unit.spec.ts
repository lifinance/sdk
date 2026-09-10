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
import { EthereumSetAllowanceTask } from './EthereumSetAllowanceTask.js'

const SOURCE_CHAIN = 1
const FROM_ADDRESS = '0xaaaa000000000000000000000000000000000001' as Address
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
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

/**
 * The native permit LI.FI's gasless relayer emits. Its `message.spender` is the
 * canonical Permit2, not `fromChain.permit2Proxy`.
 */
const buildRelayerPermitTypedData = (): TypedData => {
  const permit = buildPermitTypedData()
  return {
    ...permit,
    message: { ...permit.message, spender: PERMIT2 },
  } as TypedData
}

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
      permit2: PERMIT2,
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

  it('runs for the gasless step shape, whose native permit names Permit2 as spender', async () => {
    // The shipped gasless shape: `[Permit(spender = permit2),
    // PermitWitnessTransferFrom]`, emitted only when the ERC-20 allowance is
    // short. Classifying that `Permit` as a relayer intent leaves
    // `hasMatchingPermit` unset, which makes the allowance tasks eligible and
    // asks a gasless user to send and fund an approval they do not owe.
    vi.mocked(signTypedData).mockResolvedValue(SIGNATURE)
    const context = buildContext([
      buildRelayerPermitTypedData(),
      buildWitnessTypedData(),
    ])

    expect(await task.shouldRun(context)).toBe(true)

    const result = await task.run(context)
    const resultContext = result.context as {
      hasMatchingPermit?: boolean
      signedTypedData?: SignedTypedData[]
    }

    expect(resultContext.hasMatchingPermit).toBe(true)
    expect(resultContext.signedTypedData).toHaveLength(1)
    expect(resultContext.signedTypedData?.[0].primaryType).toBe('Permit')

    // `hasSufficientAllowance` is unset, which is the case gasless emits the
    // permit for. Only `hasMatchingPermit` keeps the approval off the user.
    expect(
      await new EthereumSetAllowanceTask().shouldRun({
        ...context,
        ...resultContext,
      } as EthereumStepExecutorContext)
    ).toBe(false)
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
      | { hasMatchingPermit?: boolean; signedTypedData?: SignedTypedData[] }
      | undefined

    expect(resultContext?.hasMatchingPermit).toBe(true)
    // The flag alone does not discriminate: dropping the `native-permit` lane
    // filter in `run` leaves it `true` while the task signs the WITNESS intent
    // as well — the one entry the classifier's first rule exists to keep out
    // of the inline-signing path.
    expect(signTypedData).toHaveBeenCalledTimes(1)
    expect(resultContext?.signedTypedData).toHaveLength(1)
    expect(resultContext?.signedTypedData?.[0].primaryType).toBe('Permit')
  })

  it('signs only the native permit on a native + relayer step, and keeps hasMatchingPermit', async () => {
    // Honest note: the flag is `true` under both the shipped
    // `!hasCallerIntent(...)` and the new `!isCallerIntentLane(...)` spelling
    // — this fixture carries no caller intent, so neither expression can
    // differ. The mixed-lane case above is the only evidence for that change.
    // What this case does pin is the lane filter in `run`.
    vi.mocked(signTypedData).mockResolvedValue(SIGNATURE)
    const context = buildContext([
      buildPermitTypedData(),
      buildWitnessTypedData(),
    ])

    const result = await task.run(context)
    const resultContext = result.context as
      | { hasMatchingPermit?: boolean; signedTypedData?: SignedTypedData[] }
      | undefined

    expect(resultContext?.hasMatchingPermit).toBe(true)
    expect(signTypedData).toHaveBeenCalledTimes(1)
    expect(resultContext?.signedTypedData).toHaveLength(1)
    expect(resultContext?.signedTypedData?.[0].primaryType).toBe('Permit')
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
