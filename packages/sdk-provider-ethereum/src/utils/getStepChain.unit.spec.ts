import type { ExtendedChain } from '@lifi/sdk'
import {
  type Chain,
  createClient,
  custom,
  type EIP1193RequestFn,
  numberToHex,
  parseTransaction,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sendTransaction } from 'viem/actions'
import { base, hyperEvm } from 'viem/chains'
import { describe, expect, it } from 'vitest'
import { convertExtendedChain } from './convertExtendedChain.js'
import { getStepChain } from './getStepChain.js'

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

describe('getStepChain', () => {
  it('returns the client chain when it is the step chain', () => {
    const { client } = createLocalAccountClient(hyperEvm)

    expect(getStepChain(client, toExtendedChain(hyperEvm))).toBe(hyperEvm)
  })

  it('returns the step chain when the client chain is another chain', () => {
    const { client } = createLocalAccountClient(base)

    expect(getStepChain(client, toExtendedChain(hyperEvm))).toMatchObject({
      id: hyperEvm.id,
    })
  })

  it('returns the step chain when the client has no chain', () => {
    const { client } = createLocalAccountClient(undefined)

    expect(getStepChain(client, toExtendedChain(hyperEvm))).toMatchObject({
      id: hyperEvm.id,
    })
  })

  // HyperEVM sets `fees.baseFeeMultiplier: 2`; a converted chain has no `fees`.
  it('keeps the fee settings of the client chain for a local account', async () => {
    const send = async (chain: Chain) => {
      const { client, sent } = createLocalAccountClient(hyperEvm)
      await sendTransaction(client, {
        to: client.account.address,
        value: 0n,
        chain,
      })
      return parseTransaction(sent[0]).maxFeePerGas
    }
    const stepChain = toExtendedChain(hyperEvm)
    const { client } = createLocalAccountClient(hyperEvm)

    const withStepChain = await send(getStepChain(client, stepChain))
    const withConvertedChain = await send(convertExtendedChain(stepChain))

    expect(withStepChain).toBeGreaterThan(withConvertedChain!)
  })
})
