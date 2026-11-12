import type { ExtendedChain } from '@lifi/sdk'
import {
  type Chain,
  type Client,
  createClient,
  custom,
  type EIP1193RequestFn,
  numberToHex,
  parseTransaction,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sendTransaction } from 'viem/actions'
import { base, hyperEvm } from 'viem/chains'
import { describe, expect, it, vi } from 'vitest'
import { convertExtendedChain } from './convertExtendedChain.js'
import { getSendChain } from './getSendChain.js'

const toExtendedChain = (chain: Chain): ExtendedChain =>
  ({
    id: chain.id,
    metamask: {
      chainId: numberToHex(chain.id),
      chainName: chain.name,
      nativeCurrency: chain.nativeCurrency,
      rpcUrls: [...chain.rpcUrls.default.http],
      blockExplorerUrls: ['https://explorer.example/'],
    },
  }) as unknown as ExtendedChain

const createLocalAccountClient = (chain: Chain | undefined) => {
  const sent: `0x${string}`[] = []
  const request = (async ({ method, params }) => {
    switch (method) {
      case 'eth_chainId':
        return numberToHex(hyperEvm.id)
      case 'eth_getBlockByNumber':
        return {
          baseFeePerGas: '0x3b9aca00',
          number: '0x1',
          hash: `0x${'00'.repeat(32)}`,
          timestamp: '0x1',
          transactions: [],
        }
      case 'eth_maxPriorityFeePerGas':
        return '0x1'
      case 'eth_getTransactionCount':
        return '0x0'
      case 'eth_estimateGas':
        return '0x5208'
      case 'eth_sendRawTransaction':
        sent.push((params as [`0x${string}`])[0])
        return `0x${'ab'.repeat(32)}`
      default:
        throw new Error(`Unexpected request: ${method}`)
    }
  }) as EIP1193RequestFn
  const client = createClient({
    account: privateKeyToAccount(`0x${'11'.repeat(32)}`),
    chain,
    transport: custom({ request }),
  })
  return { client, sent }
}

const stepChain = convertExtendedChain(toExtendedChain(hyperEvm))

describe('getSendChain', () => {
  it('keeps the client chain object when it is the given chain', () => {
    const clientChain = { ...hyperEvm, custom: { getEip712Domain: vi.fn() } }
    const { client } = createLocalAccountClient(clientChain)

    expect(getSendChain(client, stepChain)).toBe(clientChain)
  })

  it('gives the given chain when the client chain is another chain', () => {
    const { client } = createLocalAccountClient(base)

    expect(getSendChain(client, stepChain)).toBe(stepChain)
  })

  it('gives the given chain when the client has no chain', () => {
    const { client } = createLocalAccountClient(undefined)

    expect(getSendChain(client, stepChain)).toBe(stepChain)
  })
})

describe('getSendChain with a local account', () => {
  // HyperEVM sets `fees.baseFeeMultiplier: 2`; a converted chain has no `fees`.
  it('keeps the fee settings of the client chain', async () => {
    const send = async (pickChain: (client: Client) => Chain) => {
      const { client, sent } = createLocalAccountClient(hyperEvm)
      await sendTransaction(client, {
        to: client.account.address,
        value: 0n,
        chain: pickChain(client),
      })
      return parseTransaction(sent[0]).maxFeePerGas
    }

    const withSendChain = await send((client) =>
      getSendChain(client, stepChain)
    )
    const withConvertedChain = await send(() => stepChain)

    expect(withSendChain).toBeGreaterThan(withConvertedChain!)
  })
})
