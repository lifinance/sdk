import type { LiFiStep } from '@lifi/sdk'
import type { Address } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../actions/getAccountCode.js', () => ({
  getAccountCode: vi.fn(),
}))

import { getAccountCode } from '../../actions/getAccountCode.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { EthereumCheckBalanceTask } from './EthereumCheckBalanceTask.js'

const SOURCE_CHAIN = 1
const FROM_ADDRESS = '0xaaaa000000000000000000000000000000000001' as Address

// Exposes the protected hook without changing production visibility.
class TestableEthereumCheckBalanceTask extends EthereumCheckBalanceTask {
  public exposed(context: EthereumStepExecutorContext): Promise<unknown> {
    return this.getCheckBalanceOptions(context)
  }
}

const buildStep = (overrides?: {
  fromAddress?: string | undefined
  fromChainId?: number
  typedData?: unknown
}): LiFiStep =>
  ({
    type: 'lifi',
    id: 'step-1',
    tool: 'lifi',
    action: {
      fromChainId: overrides?.fromChainId ?? SOURCE_CHAIN,
      fromAddress:
        'fromAddress' in (overrides ?? {})
          ? overrides!.fromAddress
          : FROM_ADDRESS,
    },
    estimate: { gasCosts: [], feeCosts: [] },
    ...(overrides?.typedData !== undefined
      ? { typedData: overrides.typedData }
      : {}),
  }) as unknown as LiFiStep

const buildContext = (step: LiFiStep): EthereumStepExecutorContext =>
  ({
    client: {} as any,
    step,
    fromChain: {
      id: SOURCE_CHAIN,
      permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    },
  }) as unknown as EthereumStepExecutorContext

const task = new TestableEthereumCheckBalanceTask()

beforeEach(() => {
  vi.clearAllMocks()
})

describe('EthereumCheckBalanceTask.getCheckBalanceOptions', () => {
  it('EOA + non-relayer step → walletPaysGas: true (preserves today behavior)', async () => {
    vi.mocked(getAccountCode).mockResolvedValue('0x')
    const step = buildStep()
    expect(await task.exposed(buildContext(step))).toEqual({
      walletPaysGas: true,
    })
  })

  it('EIP-7702 delegated EOA + non-relayer step → walletPaysGas: true (delegated EOA still pays its own gas)', async () => {
    vi.mocked(getAccountCode).mockResolvedValue(
      '0xef0100a94f5374fce5edbc8e2a8697c15331677e6ebf0b' as `0x${string}`
    )
    const step = buildStep()
    expect(await task.exposed(buildContext(step))).toEqual({
      walletPaysGas: true,
    })
  })

  it('smart-contract wallet (Safe / 4337 / 7579 / custom) + non-relayer step → walletPaysGas: false (the headline regression test)', async () => {
    vi.mocked(getAccountCode).mockResolvedValue('0x6080' as `0x${string}`)
    const step = buildStep()
    expect(await task.exposed(buildContext(step))).toEqual({
      walletPaysGas: false,
    })
  })

  it('relayer step short-circuits to walletPaysGas: false without reading account code', async () => {
    // Pins the short-circuit so a future refactor can't silently re-introduce
    // an `eth_getCode` round-trip on the relayer hot path.
    const step = buildStep({
      typedData: [
        {
          primaryType: 'PermitWitnessTransferFrom',
          domain: {},
          types: {},
          message: {},
        },
      ],
    })
    expect(await task.exposed(buildContext(step))).toEqual({
      walletPaysGas: false,
    })
    expect(getAccountCode).not.toHaveBeenCalled()
  })

  it('Permit2 allowance step keeps the gas check: the user pays for this transaction', async () => {
    vi.mocked(getAccountCode).mockResolvedValue('0x')
    const step = buildStep({
      typedData: [
        {
          primaryType: 'PermitSingle',
          domain: {},
          types: {},
          message: { spender: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af' },
        },
      ],
    })
    expect(await task.exposed(buildContext(step))).toEqual({
      walletPaysGas: true,
    })
    expect(getAccountCode).toHaveBeenCalled()
  })

  it('native-permit-only step keeps the historical skip without reading account code', async () => {
    const step = buildStep({
      typedData: [
        {
          primaryType: 'Permit',
          domain: {},
          types: {},
          message: {},
        },
      ],
    })
    expect(await task.exposed(buildContext(step))).toEqual({
      walletPaysGas: false,
    })
    expect(getAccountCode).not.toHaveBeenCalled()
  })

  it('native permit + Permit2 allowance keeps the gas check: the user still pays', async () => {
    vi.mocked(getAccountCode).mockResolvedValue('0x')
    const step = buildStep({
      typedData: [
        {
          primaryType: 'Permit',
          domain: {},
          types: {},
          message: { spender: '0xdddd000000000000000000000000000000000004' },
        },
        {
          primaryType: 'PermitSingle',
          domain: {},
          types: {},
          message: { spender: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af' },
        },
      ],
    })
    expect(await task.exposed(buildContext(step))).toEqual({
      walletPaysGas: true,
    })
    expect(getAccountCode).toHaveBeenCalled()
  })

  it('mixed relayer + Permit2 allowance keeps the skip: the relayer still funds that lane', async () => {
    const step = buildStep({
      typedData: [
        {
          primaryType: 'PermitWitnessTransferFrom',
          domain: {},
          types: {},
          message: {},
        },
        {
          primaryType: 'PermitSingle',
          domain: {},
          types: {},
          message: { spender: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af' },
        },
      ],
    })
    expect(await task.exposed(buildContext(step))).toEqual({
      walletPaysGas: false,
    })
  })

  it('RPC failure (getAccountCode → undefined) for non-relayer step → walletPaysGas: true (conservative: keep strict gas check)', async () => {
    vi.mocked(getAccountCode).mockResolvedValue(undefined)
    const step = buildStep()
    expect(await task.exposed(buildContext(step))).toEqual({
      walletPaysGas: true,
    })
  })

  it('missing step.action.fromAddress → defers to base default (no walletPaysGas key, getAccountCode never called)', async () => {
    const step = buildStep({ fromAddress: undefined })
    expect(await task.exposed(buildContext(step))).toEqual({})
    expect(getAccountCode).not.toHaveBeenCalled()
  })

  it('uses step.action.fromChainId (NOT the wallet client chain) when querying account code', async () => {
    // Cross-chain regression — classify on the chain the step executes on.
    vi.mocked(getAccountCode).mockResolvedValue('0x')
    const step = buildStep({ fromChainId: 137 })
    await task.exposed(buildContext(step))
    expect(getAccountCode).toHaveBeenCalledWith({
      client: expect.anything(),
      chainId: 137,
      address: FROM_ADDRESS,
    })
  })
})
