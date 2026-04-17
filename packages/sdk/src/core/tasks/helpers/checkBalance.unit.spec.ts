import type { LiFiStep, Token, TokenAmount } from '@lifi/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../utils/sleep.js', () => ({
  sleep: vi.fn(() => Promise.resolve(null)),
}))

import { LiFiErrorCode } from '../../../errors/constants.js'
import type { SDKClient, SDKProvider } from '../../../types/core.js'
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
  attempts: AttemptScript[]
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

  it('adjusts source amount within slippage on the final attempt', async () => {
    const step = buildStep({ slippage: 0.005, fromAmount: '1000000' })
    // 0.5% slippage allows 995_000 minimum
    const { client } = buildClient(
      Array(6).fill({ [USDC.address.toLowerCase()]: 996_000n })
    )
    await expect(checkBalance(client, WALLET, step)).resolves.toBeUndefined()
    expect(step.action.fromAmount).toBe('996000')
  })

  it('does not adjust when below slippage tolerance', async () => {
    const step = buildStep({ slippage: 0.005, fromAmount: '1000000' })
    const { client } = buildClient(
      Array(6).fill({ [USDC.address.toLowerCase()]: 990_000n })
    )
    await expect(checkBalance(client, WALLET, step)).rejects.toMatchObject({
      code: LiFiErrorCode.BalanceError,
      message: 'The balance is too low.',
    })
    expect(step.action.fromAmount).toBe('1000000')
  })

  it('honours slippage to 1bp precision', async () => {
    const step = buildStep({ slippage: 0.0001, fromAmount: '1000000000' })
    // 1bp slippage → minimum acceptable 999_900_000
    const { client } = buildClient(
      Array(6).fill({ [USDC.address.toLowerCase()]: 999_900_000n })
    )
    await expect(checkBalance(client, WALLET, step)).resolves.toBeUndefined()
    expect(step.action.fromAmount).toBe('999900000')
  })
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

  it('sums source amount and gas when source token is native, never trimming gas via slippage', async () => {
    const step = buildStep({
      fromToken: NATIVE_ETH,
      fromAmount: '1000000000000000000', // 1 ETH
      slippage: 0.005,
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
    // Wallet has 0.999 ETH. Even the slippage minimum
    // (1 ETH * 0.995 + 0.005 ETH overhead = 1.0 ETH) is unmet → reject.
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

  it('on slippage adjustment, preserves the gas overhead reserve', async () => {
    const step = buildStep({
      fromToken: NATIVE_ETH,
      fromAmount: '1000000000000000000', // 1 ETH
      slippage: 0.01,
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
    // Wallet 0.999 ETH. minAcceptable = 1 * 0.99 + 0.005 = 0.995 ETH ≤ 0.999.
    // Trim source to 0.999 - 0.005 = 0.994 ETH.
    const { client } = buildClient(
      Array(6).fill({
        [NATIVE_ETH.address.toLowerCase()]: 999_000_000_000_000_000n,
      })
    )
    await expect(checkBalance(client, WALLET, step)).resolves.toBeUndefined()
    expect(step.action.fromAmount).toBe('994000000000000000')
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

  it('never trims overhead tokens by slippage on the final attempt', async () => {
    const step = buildStep({ slippage: 0.5 }) // very generous slippage
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
})
