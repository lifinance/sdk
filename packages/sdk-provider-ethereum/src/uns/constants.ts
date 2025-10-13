import { ChainId, ChainType } from '@lifi/types'
import type { Address } from 'viem'

export const UNS_PROXY_READER_ADDRESSES: Record<number, Address> = {
  [ChainId.ETH]: '0x578853aa776Eef10CeE6c4dd2B5862bdcE767A8B',
  [ChainId.POL]: '0x91EDd8708062bd4233f4Dd0FCE15A7cb4d500091',
} as const

export const getUNSProxyAddress = (chainId: number): Address | undefined =>
  UNS_PROXY_READER_ADDRESSES[chainId]

export const UNSProxyReaderABI = [
  {
    constant: true,
    inputs: [
      {
        internalType: 'string[]',
        name: 'keys',
        type: 'string[]',
      },
      {
        internalType: 'uint256',
        name: 'tokenId',
        type: 'uint256',
      },
    ],
    name: 'getData',
    outputs: [
      {
        internalType: 'address',
        name: 'resolver',
        type: 'address',
      },
      {
        internalType: 'address',
        name: 'owner',
        type: 'address',
      },
      {
        internalType: 'string[]',
        name: 'values',
        type: 'string[]',
      },
    ],
    payable: false,
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'exists',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

export const CHAIN_TYPE_UNS_CHAIN_MAP: Record<ChainType, string> = {
  [ChainType.EVM]: 'ETH',
  [ChainType.MVM]: 'SUI',
  [ChainType.SVM]: 'SOL',
  [ChainType.UTXO]: 'BTC',
  [ChainType.TVM]: 'TRON',
}

export const CHAIN_ID_UNS_CHAIN_MAP: Partial<Record<ChainId, string>> = {
  [ChainId.ETH]: 'ETH',
  [ChainId.BTC]: 'BTC',
  [ChainId.SUI]: 'SUI',
  [ChainId.SOL]: 'SOL',
  [ChainId.BAS]: 'BASE',
  [ChainId.POL]: 'MATIC',
  [ChainId.ARB]: 'ARB1',
  [ChainId.AVA]: 'AVAX',
}

export const CHAIN_TYPE_FAMILY_MAP: Record<ChainType, string> = {
  [ChainType.EVM]: 'EVM',
  [ChainType.UTXO]: 'BTC',
  [ChainType.SVM]: 'SOL',
  [ChainType.MVM]: 'SUI',
  [ChainType.TVM]: 'TRON',
}
