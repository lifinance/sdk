import type { SDKClient } from '@lifi/sdk'
import {
  type Address,
  type Chain,
  createClient,
  custom,
  type EIP1193RequestFn,
  type Hash,
  numberToHex,
} from 'viem'
import { base, celo } from 'viem/chains'
import { describe, expect, it, vi } from 'vitest'
import { setAllowance } from './setAllowance.js'

const FROM_ADDRESS = '0xaaaa000000000000000000000000000000000001' as Address
const TOKEN = '0xcccc000000000000000000000000000000000003' as Address
const SPENDER = '0xbbbb000000000000000000000000000000000002' as Address
const TX_HASH = `0x${'ab'.repeat(32)}` as Hash

/** A wallet on `walletChain` behind a client whose `chain` is `clientChain`. */
const createWalletClient = (clientChain: Chain, walletChain: Chain) => {
  const requests: { method: string; params?: unknown }[] = []
  const request = (async ({ method, params }) => {
    requests.push({ method, params })
    switch (method) {
      case 'eth_chainId':
        return numberToHex(walletChain.id)
      case 'eth_sendTransaction':
        return TX_HASH
      default:
        throw new Error(`Unexpected wallet request: ${method}`)
    }
  }) as EIP1193RequestFn
  const client = createClient({
    account: FROM_ADDRESS,
    chain: clientChain,
    transport: custom({ request }),
  })
  return { client, requests }
}

describe('setAllowance', () => {
  it('sends the approve on the given chain when the client holds a stale chain', async () => {
    const { client, requests } = createWalletClient(celo, base)

    const hash = await setAllowance(
      {} as SDKClient,
      client,
      TOKEN,
      SPENDER,
      1n,
      undefined,
      false,
      base
    )

    // A JSON-RPC account's `eth_sendTransaction` carries no chain id.
    expect(hash).toBe(TX_HASH)
    expect(requests.map(({ method }) => method)).toEqual([
      'eth_chainId',
      'eth_sendTransaction',
    ])
  })

  it('sends the given chain to viem', async () => {
    const { client } = createWalletClient(celo, celo)
    const sendTransaction = vi.fn(async () => TX_HASH)
    const extendedClient = client.extend(() => ({ sendTransaction }))

    await setAllowance(
      {} as SDKClient,
      extendedClient,
      TOKEN,
      SPENDER,
      1n,
      undefined,
      false,
      celo
    )

    expect(sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ chain: celo })
    )
  })

  it('keeps the client chain when no chain is given', async () => {
    const { client } = createWalletClient(celo, base)

    await expect(
      setAllowance({} as SDKClient, client, TOKEN, SPENDER, 1n)
    ).rejects.toThrow(/does not match the target chain/)
  })
})
