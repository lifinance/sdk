import { ChainId, type SDKClient } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tronWebCache } from '../../rpc/callTronRpcsWithRetry.js'
import {
  addressArgument,
  fakeTronNode,
  hexAddress,
  tronAddress,
} from '../../rpc/tronNode.unit.mock.js'
import type { TronStepExecutorContext } from '../../types.js'
import { TronCheckAllowanceTask } from './TronCheckAllowanceTask.js'

const RPC_URL = 'https://tron-allowance.test'
const OWNER = 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8'
const SPENDER = 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7'
const ALLOWANCE = 1_000_000n

const client = {
  getRpcUrlsByChainId: async () => [RPC_URL],
} as unknown as SDKClient

const contextFor = (token: string, fromAmount: bigint) =>
  ({
    step: {
      action: {
        fromChainId: ChainId.TRN,
        fromToken: { address: token },
        fromAmount: fromAmount.toString(),
      },
      estimate: { approvalAddress: SPENDER },
    },
    client,
    wallet: { address: OWNER },
    statusManager: {
      initializeAction: vi.fn(() => ({ type: 'CHECK_ALLOWANCE' })),
      updateAction: vi.fn(),
    },
  }) as unknown as TronStepExecutorContext

beforeEach(() => {
  tronWebCache.clear()
})

afterEach(() => {
  tronWebCache.clear()
  vi.restoreAllMocks()
})

describe('TronCheckAllowanceTask', () => {
  // `tronWeb.contract().at(token)` sends `wallet/getcontract` on every call
  // and keeps each token's ABI and bytecode in `trx.cache.contracts`, which
  // never shrinks. A static TRC-20 ABI needs neither.
  it('reads the allowance without fetching the token contract', async () => {
    const node = fakeTronNode(RPC_URL, ALLOWANCE)
    const task = new TronCheckAllowanceTask()
    const tokens = [1, 2, 3, 4, 5].map(tronAddress)

    for (const token of tokens) {
      await expect(
        task.run(contextFor(token, ALLOWANCE))
      ).resolves.toMatchObject({
        context: { hasSufficientAllowance: true },
      })
      await expect(
        task.run(contextFor(token, ALLOWANCE + 1n))
      ).resolves.toMatchObject({
        context: { hasSufficientAllowance: false },
      })
    }

    expect(node.endpoints).not.toContain('wallet/getcontract')
    expect(node.cachedContracts()).toBe(0)
    // Each run calls allowance(owner, spender) on its own token.
    expect(node.constantCalls).toEqual(
      tokens.flatMap((token) => {
        const call = {
          contractAddress: hexAddress(token),
          functionSelector: 'allowance(address,address)',
          parameter: addressArgument(OWNER) + addressArgument(SPENDER),
        }
        return [call, call]
      })
    )
  })
})
