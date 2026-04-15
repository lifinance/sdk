import type { LiFiStep, Token, TokenAmount } from '@lifi/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/sleep.js', () => ({
  sleep: vi.fn(() => Promise.resolve(null)),
}))

let mockProviders: SDKProvider[] = []
vi.mock('../config.js', () => ({
  config: {
    get: () => ({ providers: mockProviders }),
  },
}))

import { LiFiErrorCode } from '../errors/constants.js'
import { checkBalance } from './checkBalance.js'
import type { SDKProvider } from './types.js'

const SOURCE_CHAIN = 1

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

const WALLET = '0xWalletAddress'

type ProviderResultMap = { [address: string]: bigint | undefined }
type AttemptScript = ProviderResultMap | 'reject'

const setupProvider = (attempts: AttemptScript[]): ReturnType<typeof vi.fn> => {
  let lastScript: AttemptScript = attempts[attempts.length - 1] ?? {}
  const getBalance = vi.fn(async (_wallet: string, tokens: Token[]) => {
    const next = attempts.shift()
    const script = next ?? lastScript
    if (next !== undefined) {
      lastScript = next
    }
    if (script === 'reject') {
      throw new Error('rpc reject')
    }
    return tokens.map((token) => {
      const amount = (script as ProviderResultMap)[token.address.toLowerCase()]
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

  mockProviders = [provider]
  return getBalance
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
  vi.restoreAllMocks()
})

describe('checkBalance — source token', () => {
  it('passes when balance >= source amount and no overhead', async () => {
    setupProvider([{ [USDC.address.toLowerCase()]: 1_000_000n }])
    await expect(checkBalance(WALLET, buildStep())).resolves.toBeUndefined()
  })

  it('throws BalanceError("balance is too low") when persistently insufficient', async () => {
    setupProvider(Array(6).fill({ [USDC.address.toLowerCase()]: 0n }))
    await expect(checkBalance(WALLET, buildStep())).rejects.toMatchObject({
      code: LiFiErrorCode.BalanceError,
      message: 'The balance is too low.',
    })
  })

  it('absorbs transient low balance and resolves on a later attempt', async () => {
    const getBalance = setupProvider([
      { [USDC.address.toLowerCase()]: 0n },
      { [USDC.address.toLowerCase()]: 0n },
      { [USDC.address.toLowerCase()]: 1_000_000n },
    ])
    await expect(checkBalance(WALLET, buildStep())).resolves.toBeUndefined()
    expect(getBalance).toHaveBeenCalledTimes(3)
  })

  it('adjusts source amount within slippage on the final attempt', async () => {
    const step = buildStep({ slippage: 0.005, fromAmount: '1000000' })
    setupProvider(Array(6).fill({ [USDC.address.toLowerCase()]: 996_000n }))
    await expect(checkBalance(WALLET, step)).resolves.toBeUndefined()
    expect(step.action.fromAmount).toBe('996000')
  })

  it('does not adjust when below slippage tolerance', async () => {
    const step = buildStep({ slippage: 0.005, fromAmount: '1000000' })
    setupProvider(Array(6).fill({ [USDC.address.toLowerCase()]: 990_000n }))
    await expect(checkBalance(WALLET, step)).rejects.toMatchObject({
      code: LiFiErrorCode.BalanceError,
      message: 'The balance is too low.',
    })
    expect(step.action.fromAmount).toBe('1000000')
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
        amount: '5000000000000000',
        amountUSD: '0',
        token: NATIVE_ETH,
      },
    ] as any
    setupProvider([
      {
        [USDC.address.toLowerCase()]: 1_000_000n,
        [NATIVE_ETH.address.toLowerCase()]: 1_000_000_000_000_000n,
      },
    ])
    await expect(checkBalance(WALLET, step)).rejects.toMatchObject({
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
        amount: '500000',
        amountUSD: '0',
        included: true,
      },
    ]
    setupProvider([{ [USDC.address.toLowerCase()]: 1_000_000n }])
    await expect(checkBalance(WALLET, step)).resolves.toBeUndefined()
  })
})

describe('checkBalance — RPC failures', () => {
  it('throws "Could not read wallet balance" when provider rejects every attempt', async () => {
    setupProvider(Array(6).fill('reject') as AttemptScript[])
    await expect(checkBalance(WALLET, buildStep())).rejects.toMatchObject({
      code: LiFiErrorCode.BalanceError,
      message: 'Could not read wallet balance.',
    })
  })

  it('throws "Could not read wallet balance" when amount stays unknown', async () => {
    setupProvider(Array(6).fill({ [USDC.address.toLowerCase()]: undefined }))
    await expect(checkBalance(WALLET, buildStep())).rejects.toMatchObject({
      code: LiFiErrorCode.BalanceError,
      message: 'Could not read wallet balance.',
    })
  })

  it('absorbs transient RPC failure and resolves on a later attempt', async () => {
    const getBalance = setupProvider([
      'reject',
      'reject',
      { [USDC.address.toLowerCase()]: 1_000_000n },
    ])
    await expect(checkBalance(WALLET, buildStep())).resolves.toBeUndefined()
    expect(getBalance).toHaveBeenCalledTimes(3)
  })
})
