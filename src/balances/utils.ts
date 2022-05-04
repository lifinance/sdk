import { Fragment, JsonFragment } from '@ethersproject/abi'
import { FallbackProvider } from '@ethersproject/providers'
import { ChainId, Token, TokenAmount } from '@lifinance/types'
import BigNumber from 'bignumber.js'
import { ethers } from 'ethers'
import { getMulticallAddress, getRpcProvider } from '../connectors'
import { fetchDataUsingMulticall, MultiCallData } from '../utils/multicall'
import { isZeroAddress } from '../utils/utils'

type Balance = {
  amount: BigNumber
  blockNumber: number
}

const balanceAbi = [
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

  if ((await getMulticallAddress(chainId)) && tokens.length > 1) {
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
  const multicallAddress = await getMulticallAddress(chainId)
  if (!multicallAddress) {
    throw new Error('No multicallAddress found for the given chain.')
  }

  return executeMulticall(walletAddress, tokens, multicallAddress, chainId)
}

const executeMulticall = async (
  walletAddress: string,
  tokens: Token[],
  multicallAddress: string,
  chainId: ChainId
): Promise<Array<TokenAmount>> => {
  // Collect calls we want to make
  const calls: Array<MultiCallData> = []
  tokens.map((token) => {
    if (isZeroAddress(token.address)) {
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

  const res = await fetchViaMulticall(
    calls,
    balanceAbi,
    chainId,
    multicallAddress
  )
  if (!res.length) {
    return []
  }

  return tokens.map((token, i: number) => {
    const amount = new BigNumber(res[i].amount.toString() || '0')
      .shiftedBy(-token.decimals)
      .toFixed()
    return {
      ...token,
      amount: amount || '0',
      blockNumber: res[i].blockNumber,
    }
  })
}

const fetchViaMulticall = async (
  calls: Array<MultiCallData>,
  abi: ReadonlyArray<Fragment | JsonFragment | string>,
  chainId: number,
  multicallAddress: string
): Promise<Balance[]> => {
  const result = await fetchDataUsingMulticall(
    calls,
    abi,
    chainId,
    multicallAddress
  )

  return result.map(({ data, blockNumber }) => {
    return {
      amount: data as BigNumber,
      blockNumber,
    }
  })
}

const getBalancesFromProvider = async (
  walletAddress: string,
  tokens: Token[]
): Promise<TokenAmount[]> => {
  const chainId = tokens[0].chainId
  const rpc = await getRpcProvider(chainId)
  const tokenAmountPromises: Promise<TokenAmount>[] = tokens.map(
    async (token): Promise<TokenAmount> => {
      let amount = '0'
      let blockNumber

      try {
        const balance = await getBalanceFromProvider(
          walletAddress,
          token.address,
          chainId,
          rpc
        )
        amount = new BigNumber(balance.amount.toString())
          .shiftedBy(-token.decimals)
          .toString()
        blockNumber = balance.blockNumber
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(e)
      }

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
  chainId: ChainId,
  provider: FallbackProvider
): Promise<Balance> => {
  const blockNumber = await getCurrentBlockNumber(chainId)

  let balance
  if (isZeroAddress(assetId)) {
    balance = await provider.getBalance(walletAddress, blockNumber)
  } else {
    const contract = new ethers.Contract(
      assetId,
      ['function balanceOf(address owner) view returns (uint256)'],
      provider
    )
    balance = await contract.balanceOf(walletAddress, {
      blockTag: blockNumber,
    })
  }
  return {
    amount: balance,
    blockNumber,
  }
}

const getCurrentBlockNumber = async (chainId: ChainId): Promise<number> => {
  const rpc = await getRpcProvider(chainId)
  return rpc.getBlockNumber()
}

export default {
  getBalances,
}
