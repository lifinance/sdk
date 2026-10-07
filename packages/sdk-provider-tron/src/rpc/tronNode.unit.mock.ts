import { TronWeb } from 'tronweb'
import { vi } from 'vitest'
import { tronWebCache } from './callTronRpcsWithRetry.js'

// A TRC-20 ABI in the shape `wallet/getcontract` returns it.
const ONCHAIN_TRC20_ABI = {
  entrys: [
    {
      name: 'balanceOf',
      type: 'Function',
      stateMutability: 'View',
      inputs: [{ name: 'who', type: 'address' }],
      outputs: [{ name: '', type: 'uint256' }],
    },
    {
      name: 'allowance',
      type: 'Function',
      stateMutability: 'View',
      inputs: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
      ],
      outputs: [{ name: '', type: 'uint256' }],
    },
  ],
}

/** A constant contract call as the full node receives it. */
export type ConstantCall = {
  /** The contract, as a hex address (`41…`). */
  contractAddress: string
  /** The function signature, for example `balanceOf(address)`. */
  functionSelector: string
  /** The ABI-encoded arguments, as hex without `0x`. */
  parameter: string
}

export type FakeTronNode = {
  tronWeb: TronWeb
  /** The endpoint of every full-node request, in order. */
  endpoints: string[]
  /** Every `wallet/triggerconstantcontract` request, in order. */
  constantCalls: ConstantCall[]
  /** The number of contracts in TronWeb's `trx.cache.contracts`. */
  cachedContracts: () => number
}

/**
 * Puts a real TronWeb for `url` in `tronWebCache`, with a fake full node.
 * Every TRC-20 read returns `uint256`.
 */
export const fakeTronNode = (url: string, uint256: bigint): FakeTronNode => {
  const tronWeb = new TronWeb({ fullHost: url })
  const endpoints: string[] = []
  const constantCalls: ConstantCall[] = []
  vi.spyOn(tronWeb.fullNode, 'request').mockImplementation((async (
    endpoint: string,
    payload?: {
      value?: string
      contract_address?: string
      function_selector?: string
      parameter?: string
    }
  ) => {
    endpoints.push(endpoint)
    switch (endpoint) {
      case 'wallet/getcontract':
        return {
          contract_address: payload?.value,
          bytecode: '00',
          abi: ONCHAIN_TRC20_ABI,
          name: 'Token',
        }
      case 'wallet/triggerconstantcontract':
        constantCalls.push({
          contractAddress: String(payload?.contract_address),
          functionSelector: String(payload?.function_selector),
          parameter: String(payload?.parameter),
        })
        return {
          result: { result: true },
          constant_result: [uint256.toString(16).padStart(64, '0')],
        }
      case 'wallet/getnowblock':
        return { block_header: { raw_data: { number: 7 } } }
      default:
        throw new Error(`Unexpected full-node request: ${endpoint}`)
    }
  }) as typeof tronWeb.fullNode.request)
  tronWebCache.set(url, tronWeb)

  const trx = tronWeb.trx as unknown as {
    cache: { contracts: Record<string, unknown> }
  }
  return {
    tronWeb,
    endpoints,
    constantCalls,
    cachedContracts: () => Object.keys(trx.cache.contracts).length,
  }
}

/** A valid base58 Tron address, distinct for each `seed`. */
export const tronAddress = (seed: number): string =>
  TronWeb.address.fromHex(`41${seed.toString(16).padStart(40, '0')}`)

/** A Tron address as a hex address (`41…`). */
export const hexAddress = (address: string): string =>
  TronWeb.address.toHex(address)

/** A Tron address as one ABI-encoded 32-byte argument, in hex. */
export const addressArgument = (address: string): string =>
  hexAddress(address).slice(2).padStart(64, '0')
