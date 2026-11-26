import type { LiFiStep, Token, TokenAmount } from '@lifi/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../utils/sleep.js', () => ({
  sleep: vi.fn(() => Promise.resolve(null)),
}))

import { LiFiErrorCode } from '../../../errors/constants.js'
import type { SDKClient, SDKProvider } from '../../../types/core.js'
import { sleep } from '../../../utils/sleep.js'
import { checkBalance } from './checkBalance.js'

const SOURCE_CHAIN = 1
const DEST_CHAIN = 137

const NATIVE_ETH: Token = {
  chainId: SOURCE_CHAIN,
  address: '0x0000000000000000000000000000000000000000',
  symbol: 'ETH',
  decimals: 18,
  name: 'Ether',
  priceUSD: '0',
}

const USDC: Token = {
  chainId: SOURCE_CHAIN,
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  symbol: 'USDC',
  decimals: 6,
  name: 'USD Coin',
  priceUSD: '0',
}

const NATIVE_MATIC: Token = {
  chainId: DEST_CHAIN,
  address: '0x0000000000000000000000000000000000000000',
  symbol: 'MATIC',
  decimals: 18,
  name: 'Matic',
  priceUSD: '0',
}

const WALLET = '0xWalletAddress'

type ProviderResultMap = { [address: string]: bigint | undefined }
type AttemptScript = ProviderResultMap | 'reject'

const buildClient = (
  attempts: AttemptScript[],
  chainOverrides: { nonStandardNativeDecimals?: boolean } = {}
): { client: SDKClient; getBalance: ReturnType<typeof vi.fn> } => {
  let lastScript: AttemptScript = attempts[attempts.length - 1] ?? {}
  const getBalance = vi.fn(async (_client, _wallet, tokens: Token[]) => {
    const next = attempts.shift()
    const script = next ?? lastScript
    if (next !== undefined) {
      lastScript = next
    }
    if (script === 'reject') {
      throw new Error('rpc reject')
    }
    return tokens.map((token) => {
      const amount = script[token.address.toLowerCase()]
      if (amount === undefined) {
        return { ...token } as TokenAmount
      }
      return { ...token, amount } as TokenAmount
    })
  })

  const provider: SDKProvider = {
    type: 'EVM' as any,
    isAddress: (addr: string) => addr === WALLET,
    resolveAddress: vi.fn(),
    getStepExecutor: vi.fn(),
    getBalance,
  }

  const client = {
    providers: [provider],
    getProvider: () => provider,
    getChainById: vi.fn(async (chainId: number) => ({
      id: chainId,
      nonStandardNativeDecimals: chainOverrides.nonStandardNativeDecimals,
    })),
  } as unknown as SDKClient

  return { client, getBalance }
}

const buildStep = (overrides: Partial<LiFiStep['action']> = {}): LiFiStep => {
  const action = {
    fromChainId: SOURCE_CHAIN,
    fromAmount: '1000000', // 1 USDC
    fromToken: USDC,
    toChainId: SOURCE_CHAIN,
    toToken: USDC,
    slippage: 0.005,
    ...overrides,
  }
  return {
    type: 'lifi',
    id: 'step-1',
    tool: 'lifi',
    toolDetails: { key: 'lifi', name: 'LI.FI', logoURI: '' },
    action,
    estimate: {
      tool: 'lifi',
      fromAmount: action.fromAmount,
      toAmount: action.fromAmount,
      toAmountMin: action.fromAmount,
      approvalAddress: '0x0',
      executionDuration: 30,
      gasCosts: [],
      feeCosts: [],
    },
    includedSteps: [],
  } as unknown as LiFiStep
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('checkBalance — source token', () => {
  it('passes when balance >= source amount and no overhead', async () => {
    const { client } = buildClient([
      { [USDC.address.toLowerCase()]: 1_000_000n },
    ])
    await expect(
      checkBalance(client, WALLET, buildStep())
    ).resolves.toBeUndefined()
  })

  it('throws BalanceError("balance is too low") when persistently insufficient', async () => {
    const { client } = buildClient(
      Array(6).fill({ [USDC.address.toLowerCase()]: 0n })
    )
    await expect(
      checkBalance(client, WALLET, buildStep())
    ).rejects.toMatchObject({
      code: LiFiErrorCode.BalanceError,
      message: 'The balance is too low.',
    })
  })

  it('absorbs transient low balance and resolves on a later attempt', async () => {
    const { client, getBalance } = buildClient([
      { [USDC.address.toLowerCase()]: 0n },
      { [USDC.address.toLowerCase()]: 0n },
      { [USDC.address.toLowerCase()]: 1_000_000n },
    ])
    await expect(
      checkBalance(client, WALLET, buildStep())
    ).resolves.toBeUndefined()
    expect(getBalance).toHaveBeenCalledTimes(3)
  })

  // The slippage is the on-chain tolerance of the swap. Spending it here as
  // well would let the user receive up to twice the slippage less.
  it.each([
    ['0.5%', 0.005],
    ['50%', 0.5],
    ['missing (Auto)', undefined],
  ])(
    'throws on a tiny shortfall with a slippage of %s and never changes the step',
    async (_, slippage) => {
      const step = buildStep({ slippage, fromAmount: '1000000' })
      step.transactionRequest = { data: '0xquoted' }
      const before = structuredClone(step)
      const { client } = buildClient(
        Array(6).fill({ [USDC.address.toLowerCase()]: 999_860n })
      )
      await expect(checkBalance(client, WALLET, step)).rejects.toMatchObject({
        code: LiFiErrorCode.BalanceError,
        message: 'The balance is too low.',
        cause: expect.objectContaining({
          message: expect.stringContaining(
            'you try to transfer 1 USDC, but your wallet only holds 0.99986 USDC'
          ),
        }),
      })
      expect(step).toEqual(before)
    }
  )
})

describe('checkBalance — overhead tokens', () => {
  it('verifies native gas balance when source token != native', async () => {
    const step = buildStep()
    step.estimate!.gasCosts = [
      {
        type: 'SUM',
        price: '0',
        estimate: '0',
        limit: '0',
        amount: '5000000000000000', // 0.005 ETH
        amountUSD: '0',
        token: NATIVE_ETH,
      },
    ] as any
    const { client } = buildClient([
      {
        [USDC.address.toLowerCase()]: 1_000_000n,
        [NATIVE_ETH.address.toLowerCase()]: 1_000_000_000_000_000n, // only 0.001 ETH
      },
    ])
    await expect(checkBalance(client, WALLET, step)).rejects.toMatchObject({
      code: LiFiErrorCode.BalanceError,
      message: 'The balance is too low.',
    })
  })

  it('passes when native gas balance is sufficient', async () => {
    const step = buildStep()
    step.estimate!.gasCosts = [
      {
        type: 'SUM',
        price: '0',
        estimate: '0',
        limit: '0',
        amount: '5000000000000000',
        amountUSD: '0',
        token: NATIVE_ETH,
      },
    ] as any
    const { client } = buildClient([
      {
        [USDC.address.toLowerCase()]: 1_000_000n,
        [NATIVE_ETH.address.toLowerCase()]: 10_000_000_000_000_000n,
      },
    ])
    await expect(checkBalance(client, WALLET, step)).resolves.toBeUndefined()
  })

  it('sums source amount and gas when source token is native', async () => {
    const step = buildStep({
      fromToken: NATIVE_ETH,
      fromAmount: '1000000000000000000', // 1 ETH
    })
    step.estimate!.gasCosts = [
      {
        type: 'SUM',
        price: '0',
        estimate: '0',
        limit: '0',
        amount: '5000000000000000', // 0.005 ETH overhead
        amountUSD: '0',
        token: NATIVE_ETH,
      },
    ] as any
    // Wallet has 0.999 ETH, below 1 ETH + 0.005 ETH gas → reject.
    const { client } = buildClient(
      Array(6).fill({
        [NATIVE_ETH.address.toLowerCase()]: 999_000_000_000_000_000n,
      })
    )
    await expect(checkBalance(client, WALLET, step)).rejects.toMatchObject({
      code: LiFiErrorCode.BalanceError,
      message: 'The balance is too low.',
    })
  })

  it('does not double-count fees flagged as included', async () => {
    const step = buildStep()
    step.estimate!.feeCosts = [
      {
        name: 'fee',
        description: '',
        percentage: '0',
        token: USDC,
        amount: '500000', // already part of fromAmount
        amountUSD: '0',
        included: true,
      },
    ]
    const { client } = buildClient([
      { [USDC.address.toLowerCase()]: 1_000_000n },
    ])
    await expect(checkBalance(client, WALLET, step)).resolves.toBeUndefined()
  })

  it('counts non-included fees on the source chain', async () => {
    const step = buildStep()
    step.estimate!.feeCosts = [
      {
        name: 'rent',
        description: '',
        percentage: '0',
        token: NATIVE_ETH,
        amount: '2000000000000000', // 0.002 ETH rent equivalent
        amountUSD: '0',
        included: false,
      },
    ]
    const { client } = buildClient([
      {
        [USDC.address.toLowerCase()]: 1_000_000n,
        [NATIVE_ETH.address.toLowerCase()]: 1_000_000_000_000_000n,
      },
    ])
    await expect(checkBalance(client, WALLET, step)).rejects.toMatchObject({
      code: LiFiErrorCode.BalanceError,
      message: 'The balance is too low.',
    })
  })

  it('ignores gas/fee costs reported on the destination chain', async () => {
    const step = buildStep()
    step.estimate!.gasCosts = [
      {
        type: 'SUM',
        price: '0',
        estimate: '0',
        limit: '0',
        amount: '5000000000000000',
        amountUSD: '0',
        token: NATIVE_MATIC, // destination chain — should be ignored
      },
    ] as any
    const { client, getBalance } = buildClient([
      { [USDC.address.toLowerCase()]: 1_000_000n },
    ])
    await expect(checkBalance(client, WALLET, step)).resolves.toBeUndefined()
    // Only the source token should have been queried.
    const tokensQueried = (getBalance.mock.calls[0][2] as Token[]).map(
      (t) => t.address
    )
    expect(tokensQueried).toEqual([USDC.address])
  })

  it('throws when only an overhead token is short', async () => {
    const step = buildStep()
    step.estimate!.gasCosts = [
      {
        type: 'SUM',
        price: '0',
        estimate: '0',
        limit: '0',
        amount: '5000000000000000',
        amountUSD: '0',
        token: NATIVE_ETH,
      },
    ] as any
    const { client } = buildClient(
      Array(6).fill({
        [USDC.address.toLowerCase()]: 1_000_000n,
        [NATIVE_ETH.address.toLowerCase()]: 1n,
      })
    )
    await expect(checkBalance(client, WALLET, step)).rejects.toMatchObject({
      code: LiFiErrorCode.BalanceError,
      message: 'The balance is too low.',
    })
  })
})

describe('checkBalance — smart-contract wallet / relayed (walletPaysGas=false)', () => {
  it('passes when source token is sufficient even though native gas balance is zero (the reported Safe Apps bug)', async () => {
    // Headline regression — before the fix, gas (paid by the signer, not
    // the Safe) was checked against the Safe's own ETH balance.
    const step = buildStep()
    step.estimate!.gasCosts = [
      {
        type: 'SUM',
        price: '0',
        estimate: '0',
        limit: '0',
        amount: '5000000000000000',
        amountUSD: '0',
        token: NATIVE_ETH,
      },
    ] as any
    const { client, getBalance } = buildClient([
      { [USDC.address.toLowerCase()]: 1_000_000n },
    ])
    await expect(
      checkBalance(client, WALLET, step, { walletPaysGas: false })
    ).resolves.toBeUndefined()
    // Pre-filter dropped the pure-gas native entry — only USDC is queried.
    const tokensQueried = (getBalance.mock.calls[0][2] as Token[]).map(
      (t) => t.address
    )
    expect(tokensQueried).toEqual([USDC.address])
  })

  it('still enforces non-included native fees (LayerZero msg.value, bridge native fee) on the wallet', async () => {
    // Non-included fees ride in the inner call's `value` and are paid by
    // the wallet even when gas isn't — must not be over-relaxed.
    const step = buildStep()
    step.estimate!.gasCosts = [
      {
        type: 'SUM',
        price: '0',
        estimate: '0',
        limit: '0',
        amount: '5000000000000000', // 0.005 ETH gas — dropped
        amountUSD: '0',
        token: NATIVE_ETH,
      },
    ] as any
    step.estimate!.feeCosts = [
      {
        name: 'lz fee',
        description: '',
        percentage: '0',
        token: NATIVE_ETH,
        amount: '2000000000000000', // 0.002 ETH non-included fee — kept
        amountUSD: '0',
        included: false,
      },
    ]

    // Wallet 0.001 ETH — fee alone (0.002) unmet.
    const insufficient = buildClient([
      {
        [USDC.address.toLowerCase()]: 1_000_000n,
        [NATIVE_ETH.address.toLowerCase()]: 1_000_000_000_000_000n,
      },
    ])
    await expect(
      checkBalance(insufficient.client, WALLET, step, { walletPaysGas: false })
    ).rejects.toMatchObject({
      code: LiFiErrorCode.BalanceError,
      message: 'The balance is too low.',
    })

    // Wallet 0.003 ETH — covers the fee even with gas excluded.
    const stepOk = buildStep()
    stepOk.estimate!.gasCosts = step.estimate!.gasCosts
    stepOk.estimate!.feeCosts = step.estimate!.feeCosts
    const sufficient = buildClient([
      {
        [USDC.address.toLowerCase()]: 1_000_000n,
        [NATIVE_ETH.address.toLowerCase()]: 3_000_000_000_000_000n,
      },
    ])
    await expect(
      checkBalance(sufficient.client, WALLET, stepOk, {
        walletPaysGas: false,
      })
    ).resolves.toBeUndefined()
  })

  it('needs only the source amount and the fee, not the gas', async () => {
    const step = buildStep({
      fromToken: NATIVE_ETH,
      fromAmount: '1000000000000000000', // 1 ETH
    })
    step.estimate!.gasCosts = [
      {
        type: 'SUM',
        price: '0',
        estimate: '0',
        limit: '0',
        amount: '5000000000000000', // 0.005 ETH gas, dropped
        amountUSD: '0',
        token: NATIVE_ETH,
      },
    ] as any
    step.estimate!.feeCosts = [
      {
        name: 'lz fee',
        description: '',
        percentage: '0',
        token: NATIVE_ETH,
        amount: '2000000000000000', // 0.002 ETH fee, kept
        amountUSD: '0',
        included: false,
      },
    ]
    // Wallet 1.002 ETH = 1 ETH + 0.002 ETH fee; the 0.005 ETH gas is not needed.
    const { client } = buildClient(
      Array(6).fill({
        [NATIVE_ETH.address.toLowerCase()]: 1_002_000_000_000_000_000n,
      })
    )
    await expect(
      checkBalance(client, WALLET, step, { walletPaysGas: false })
    ).resolves.toBeUndefined()
    expect(step.action.fromAmount).toBe('1000000000000000000')
  })

  it('default (walletPaysGas omitted) preserves the strict gas check — no behavior change for EOA executions', async () => {
    // Gates the new path behind an explicit opt-in from a chain subclass.
    const step = buildStep()
    step.estimate!.gasCosts = [
      {
        type: 'SUM',
        price: '0',
        estimate: '0',
        limit: '0',
        amount: '5000000000000000',
        amountUSD: '0',
        token: NATIVE_ETH,
      },
    ] as any
    const { client } = buildClient(
      Array(6).fill({
        [USDC.address.toLowerCase()]: 1_000_000n,
        [NATIVE_ETH.address.toLowerCase()]: 0n,
      })
    )
    await expect(checkBalance(client, WALLET, step)).rejects.toMatchObject({
      code: LiFiErrorCode.BalanceError,
      message: 'The balance is too low.',
    })
  })
})

describe('checkBalance — non-standard native decimals chains', () => {
  it('skips the gas check on chains with nonStandardNativeDecimals=true', async () => {
    // Tempo / Stable report gas in units that don't match wallet balances;
    // gas would otherwise be over-counted and trip the check.
    const step = buildStep()
    step.estimate!.gasCosts = [
      {
        type: 'SUM',
        price: '0',
        estimate: '0',
        limit: '0',
        amount: '5000000000000000',
        amountUSD: '0',
        token: NATIVE_ETH,
      },
    ] as any
    const { client, getBalance } = buildClient(
      [{ [USDC.address.toLowerCase()]: 1_000_000n }],
      { nonStandardNativeDecimals: true }
    )
    await expect(checkBalance(client, WALLET, step)).resolves.toBeUndefined()
    // The pure-gas native entry is dropped — only the source token is queried.
    const tokensQueried = (getBalance.mock.calls[0][2] as Token[]).map(
      (t) => t.address
    )
    expect(tokensQueried).toEqual([USDC.address])
  })

  it('still enforces non-included native fees on nonStandardNativeDecimals chains', async () => {
    const step = buildStep()
    step.estimate!.gasCosts = [
      {
        type: 'SUM',
        price: '0',
        estimate: '0',
        limit: '0',
        amount: '5000000000000000', // gas — dropped
        amountUSD: '0',
        token: NATIVE_ETH,
      },
    ] as any
    step.estimate!.feeCosts = [
      {
        name: 'lz fee',
        description: '',
        percentage: '0',
        token: NATIVE_ETH,
        amount: '2000000000000000', // non-included native fee — kept
        amountUSD: '0',
        included: false,
      },
    ]
    const { client } = buildClient(
      [
        {
          [USDC.address.toLowerCase()]: 1_000_000n,
          [NATIVE_ETH.address.toLowerCase()]: 1_000_000_000_000_000n,
        },
      ],
      { nonStandardNativeDecimals: true }
    )
    await expect(checkBalance(client, WALLET, step)).rejects.toMatchObject({
      code: LiFiErrorCode.BalanceError,
      message: 'The balance is too low.',
    })
  })
})

describe('checkBalance — RPC failures', () => {
  it('throws "Could not read wallet balance" when provider rejects every attempt', async () => {
    const { client } = buildClient(Array(6).fill('reject') as AttemptScript[])
    await expect(
      checkBalance(client, WALLET, buildStep())
    ).rejects.toMatchObject({
      code: LiFiErrorCode.BalanceError,
      message: 'Could not read wallet balance.',
    })
  })

  it('throws "Could not read wallet balance" when amount stays unknown', async () => {
    const { client } = buildClient(
      Array(6).fill({ [USDC.address.toLowerCase()]: undefined })
    )
    await expect(
      checkBalance(client, WALLET, buildStep())
    ).rejects.toMatchObject({
      code: LiFiErrorCode.BalanceError,
      message: 'Could not read wallet balance.',
    })
  })

  it('absorbs transient RPC failure and resolves on a later attempt', async () => {
    const { client, getBalance } = buildClient([
      'reject',
      'reject',
      { [USDC.address.toLowerCase()]: 1_000_000n },
    ])
    await expect(
      checkBalance(client, WALLET, buildStep())
    ).resolves.toBeUndefined()
    expect(getBalance).toHaveBeenCalledTimes(3)
  })

  it('absorbs transient unknown amount and resolves on a later attempt', async () => {
    const { client, getBalance } = buildClient([
      { [USDC.address.toLowerCase()]: undefined },
      { [USDC.address.toLowerCase()]: 1_000_000n },
    ])
    await expect(
      checkBalance(client, WALLET, buildStep())
    ).resolves.toBeUndefined()
    expect(getBalance).toHaveBeenCalledTimes(2)
  })

  it('reports the shortfall of the last good read when later reads miss the balance', async () => {
    const { client } = buildClient([
      { [USDC.address.toLowerCase()]: 996_000n },
      ...Array(5).fill({ [USDC.address.toLowerCase()]: undefined }),
    ])
    await expect(
      checkBalance(client, WALLET, buildStep())
    ).rejects.toMatchObject({
      code: LiFiErrorCode.BalanceError,
      message: 'The balance is too low.',
      cause: expect.objectContaining({
        message: expect.stringContaining('only holds 0.996 USDC'),
      }),
    })
  })
})

describe('checkBalance — overall timeout', () => {
  const readsTaking = (
    getBalance: ReturnType<typeof vi.fn>,
    ms: number,
    amount: bigint
  ) =>
    getBalance.mockImplementation(
      (_client, _wallet, tokens: Token[]) =>
        new Promise<TokenAmount[]>((resolve) =>
          setTimeout(
            () => resolve(tokens.map((token) => ({ ...token, amount }))),
            ms
          )
        )
    )

  // Fake timers, with a backoff sleep that takes its real time on them, so
  // the time-limit tests count the backoff like production does.
  const useFakeClock = () => {
    vi.useFakeTimers()
    vi.mocked(sleep).mockImplementation(
      (ms: number) =>
        new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))
    )
  }

  afterEach(() => {
    vi.mocked(sleep).mockImplementation(() => Promise.resolve(null))
    vi.useRealTimers()
  })

  it('passes a signal to every backoff sleep and aborts it when it settles', async () => {
    const { client } = buildClient([
      'reject',
      { [USDC.address.toLowerCase()]: 0n },
      { [USDC.address.toLowerCase()]: 1_000_000n },
    ])

    await expect(
      checkBalance(client, WALLET, buildStep())
    ).resolves.toBeUndefined()

    // One sleep after the failed read, one after the low balance.
    const calls = vi.mocked(sleep).mock.calls
    expect(calls).toHaveLength(2)
    for (const [, options] of calls) {
      expect(options?.signal?.aborted).toBe(true)
    }
  })

  it('passes when a read takes 4 s and the balance covers the step', async () => {
    useFakeClock()
    const { client, getBalance } = buildClient([])
    readsTaking(getBalance, 4_000, 1_000_000n)
    const checked = expect(
      checkBalance(client, WALLET, buildStep())
    ).resolves.toBeUndefined()
    await vi.advanceTimersByTimeAsync(4_000)
    await checked
    expect(getBalance).toHaveBeenCalledTimes(1)
  })

  it('reports the real shortfall when each read takes 4 s', async () => {
    useFakeClock()
    const { client, getBalance } = buildClient([])
    readsTaking(getBalance, 4_000, 980_000n)
    const checked = expect(
      checkBalance(client, WALLET, buildStep())
    ).rejects.toMatchObject({
      code: LiFiErrorCode.BalanceError,
      message: 'The balance is too low.',
      cause: expect.objectContaining({
        message: expect.stringContaining('only holds 0.98 USDC'),
      }),
    })
    await vi.advanceTimersByTimeAsync(15_000)
    await checked
  })

  it('does not start a backoff that ends after the time limit', async () => {
    useFakeClock()
    const { client, getBalance } = buildClient([])
    readsTaking(getBalance, 7_300, 980_000n)
    const checked = expect(
      checkBalance(client, WALLET, buildStep())
    ).rejects.toMatchObject({
      message: 'The balance is too low.',
    })
    // Read 1 ends at 7.3 s and the backoff at 7.45 s. Read 2 ends at 14.75 s.
    // The next backoff (300 ms) would end after 15 s.
    await vi.advanceTimersByTimeAsync(14_750)
    await checked
    expect(getBalance).toHaveBeenCalledTimes(2)
    expect(vi.mocked(sleep)).toHaveBeenCalledTimes(1)
  })

  it('throws "Could not read wallet balance" with a cause when no read finishes in time', async () => {
    useFakeClock()
    const { client, getBalance } = buildClient([])
    getBalance.mockImplementation(() => new Promise<TokenAmount[]>(() => {}))
    const checked = expect(
      checkBalance(client, WALLET, buildStep())
    ).rejects.toMatchObject({
      code: LiFiErrorCode.BalanceError,
      message: 'Could not read wallet balance.',
      cause: expect.objectContaining({ message: 'Balance read timed out.' }),
    })
    await vi.advanceTimersByTimeAsync(15_000)
    await checked
    expect(getBalance).toHaveBeenCalledTimes(1)
  })

  it('decides from the last good read when the final read hangs, and ignores the late read', async () => {
    useFakeClock()
    const step = buildStep()
    const before = structuredClone(step)
    const { client, getBalance } = buildClient([])
    const balanceOf =
      (amount: bigint) =>
      (tokens: Token[]): TokenAmount[] =>
        tokens.map((token) => ({ ...token, amount }))
    let releaseFinalRead!: () => void
    getBalance.mockImplementation(async (_client, _wallet, tokens: Token[]) => {
      if (getBalance.mock.calls.length < 6) {
        return balanceOf(996_000n)(tokens)
      }
      // The final read hangs past the time limit.
      return new Promise<TokenAmount[]>((resolve) => {
        releaseFinalRead = () => resolve(balanceOf(1_000_000n)(tokens))
      })
    })

    const checked = expect(
      checkBalance(client, WALLET, step)
    ).rejects.toMatchObject({
      message: 'The balance is too low.',
      cause: expect.objectContaining({
        message: expect.stringContaining('only holds 0.996 USDC'),
      }),
    })
    await vi.advanceTimersByTimeAsync(15_000)
    await checked

    releaseFinalRead()
    await vi.advanceTimersByTimeAsync(0)
    expect(step).toEqual(before)
    expect(getBalance).toHaveBeenCalledTimes(6)
  })
})
