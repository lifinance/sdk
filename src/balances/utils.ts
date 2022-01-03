/* eslint-disable @typescript-eslint/ban-ts-comment */
import { FallbackProvider } from '@ethersproject/providers'
import { Contract } from '@ethersproject/contracts'
import { ChainId, Token, TokenAmount } from '@lifinance/types'
import BigNumber from 'bignumber.js'
import { Bytes, constants, ethers } from 'ethers'

import { getMulticallAddress, getRpcProvider } from '../connectors'
import { splitListIntoChunks } from '../utils'
import { Interface } from '@ethersproject/abi'

const MAX_MULTICALL_SIZE = 100

type Call = {
  address: string
  name: string
  params?: any[]
}

export const MulticallAbi = [
  {
    constant: true,
    inputs: [
      {
        components: [
          { name: 'target', type: 'address' },
          { name: 'callData', type: 'bytes' },
        ],
        name: 'calls',
        type: 'tuple[]',
      },
    ],
    name: 'aggregate',
    outputs: [
      { name: 'blockNumber', type: 'uint256' },
      { name: 'returnData', type: 'bytes[]' },
    ],
    payable: false,
    stateMutability: 'view',
    type: 'function',
  },
  {
    constant: true,
    inputs: [{ name: 'addr', type: 'address' }],
    name: 'getEthBalance',
    outputs: [{ name: 'balance', type: 'uint256' }],
    payable: false,
    stateMutability: 'view',
    type: 'function',
  },
]

export const balanceAbi = [
  {
    constant: true,
    inputs: [{ name: 'who', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    payable: false,
    stateMutability: 'view',
    type: 'function',
  },
  {
    constant: true,
    inputs: [{ name: 'addr', type: 'address' }],
    name: 'getEthBalance',
    outputs: [{ name: 'balance', type: 'uint256' }],
    payable: false,
    stateMutability: 'view',
    type: 'function',
  },
]

const getBalances = async (
  walletAddress: string,
  tokens: Token[]
): Promise<TokenAmount[]> => {
  if (tokens.length === 0) {
    return []
  }
  const { chainId } = tokens[0]
  tokens.forEach((token) => {
    if (token.chainId !== chainId) {
      // eslint-disable-next-line no-console
      console.warn(`Requested tokens have to be on same chain.`)
      return []
    }
  })

  if (getMulticallAddress(chainId) && tokens.length > 1) {
    return getBalancesFromProviderUsingMulticall(walletAddress, tokens)
  } else {
    return getBalancesFromProvider(walletAddress, tokens)
  }
}

const getBalancesFromProviderUsingMulticall = async (
  walletAddress: string,
  tokens: Token[]
): Promise<TokenAmount[]> => {
  // Configuration
  const { chainId } = tokens[0]
  const multicallAddress = getMulticallAddress(chainId)
  if (!multicallAddress) {
    throw new Error('No multicallAddress found for given chain')
  }

  if (tokens.length > MAX_MULTICALL_SIZE) {
    const chunkedList = splitListIntoChunks<Token>(tokens, MAX_MULTICALL_SIZE)
    const chunkedResults = await Promise.all(
      chunkedList.map((tokenChunk) =>
        executeMulticall(walletAddress, tokenChunk, multicallAddress, chainId)
      )
    )
    return chunkedResults.flat()
  } else {
    return executeMulticall(walletAddress, tokens, multicallAddress, chainId)
  }
}

const executeMulticall = async (
  walletAddress: string,
  tokens: Token[],
  multicallAddress: string,
  chainId: ChainId
): Promise<Array<TokenAmount>> => {
  // Collect calls we want to make
  const calls: Array<Call> = []
  tokens.map((token) => {
    if (token.address === constants.AddressZero) {
      calls.push({
        address: multicallAddress,
        name: 'getEthBalance',
        params: [walletAddress],
      })
    } else {
      calls.push({
        address: token.address,
        name: 'balanceOf',
        params: [walletAddress],
      })
    }
  })

  const res = await fetchDataUsingMulticall(
    calls,
    balanceAbi,
    chainId,
    multicallAddress
  )
  if (!res.length) return []

  const blockNumber = await getCurrentBlockNumber(chainId)

  return tokens.map((token, i: number) => {
    const amount = new BigNumber(res[i][0].toString() || '0')
      .shiftedBy(-token.decimals)
      .toFixed()
    return {
      ...token,
      amount: amount || '0',
      blockNumber,
    }
  })
}

const fetchDataUsingMulticall = async (
  calls: Array<Call>,
  abi: any[],
  chainId: number,
  multicallAddress: string
) => {
  // 1. create contract using multicall contract address and abi...
  const multicallContract = new Contract(
    multicallAddress,
    MulticallAbi,
    getRpcProvider(chainId)
  )
  const abiInterface = new Interface(abi)
  const callData = calls.map((call) => [
    call.address.toLowerCase(),
    abiInterface.encodeFunctionData(call.name, call.params),
  ])
  try {
    // 3. get bytes array from multicall contract by process aggregate method...
    const { returnData } = await multicallContract.aggregate(callData)
    // 4. decode bytes array to useful data array...
    return returnData.map((call: Bytes, i: number) =>
      abiInterface.decodeFunctionResult(calls[i].name, call)
    )
  } catch (e) {
    return []
  }
}

const getBalancesFromProvider = async (
  walletAddress: string,
  tokens: Token[]
): Promise<TokenAmount[]> => {
  const chainId = tokens[0].chainId
  const rpc = getRpcProvider(chainId)

  const tokenAmountPromises: Promise<TokenAmount>[] = tokens.map(
    async (token): Promise<TokenAmount> => {
      let amount = '0'

      try {
        const amountRaw = await getBalanceFromProvider(
          walletAddress,
          token.address,
          rpc
        )
        amount = amountRaw.shiftedBy(-token.decimals).toString()
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(e)
      }

      const blockNumber = await getCurrentBlockNumber(chainId)

      return {
        ...token,
        amount,
        blockNumber,
      }
    }
  )
  return Promise.all(tokenAmountPromises)
}

const getBalanceFromProvider = async (
  walletAddress: string,
  assetId: string,
  provider: FallbackProvider
): Promise<BigNumber> => {
  let balance
  if (assetId === constants.AddressZero) {
    balance = await provider.getBalance(walletAddress)
  } else {
    const contract = new ethers.Contract(
      assetId,
      ['function balanceOf(address owner) view returns (uint256)'],
      provider
    )
    balance = await contract.balanceOf(walletAddress)
  }
  return new BigNumber(balance.toString())
}

const getCurrentBlockNumber = (chainId: ChainId): Promise<number> => {
  const rpc = getRpcProvider(chainId)
  return rpc.getBlockNumber()
}

export default {
  getBalances,
}
