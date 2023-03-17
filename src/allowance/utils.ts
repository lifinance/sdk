import { TransactionRequest } from '@ethersproject/abstract-provider'
import { ChainId, Token } from '@lifi/types'
import BigNumber from 'bignumber.js'
import { Contract, ContractTransaction, Signer } from 'ethers'
import ChainsService from '../services/ChainsService'
import { ERC20Contract, ERC20_ABI, RevokeTokenData } from '../types'
import { ServerError } from '../utils/errors'
import { fetchDataUsingMulticall, MultiCallData } from '../utils/multicall'

export const getApproved = async (
  signer: Signer,
  tokenAddress: string,
  contractAddress: string,
  transactionRequest?: TransactionRequest
): Promise<BigNumber> => {
  const signerAddress = await signer.getAddress()
  const erc20 = new Contract(tokenAddress, ERC20_ABI, signer) as ERC20Contract

  try {
    const approved = await erc20.allowance(signerAddress, contractAddress, {
      gasLimit: transactionRequest?.gasLimit,
      gasPrice: transactionRequest?.gasPrice,
      maxFeePerGas: transactionRequest?.maxFeePerGas,
      maxPriorityFeePerGas: transactionRequest?.maxPriorityFeePerGas,
    })
    return new BigNumber(approved.toString())
  } catch (e) {
    return new BigNumber(0)
  }
}

export const setApproval = (
  signer: Signer,
  tokenAddress: string,
  contractAddress: string,
  amount: string
): Promise<ContractTransaction> => {
  const erc20 = new Contract(tokenAddress, ERC20_ABI, signer) as ERC20Contract

  return erc20.approve(contractAddress, amount)
}

export const getAllowanceViaMulticall = async (
  signer: Signer,
  chainId: ChainId,
  tokenData: RevokeTokenData[]
): Promise<
  { token: Token; approvalAddress: string; approvedAmount: BigNumber }[]
> => {
  const chainsService = ChainsService.getInstance()
  const chain = await chainsService.getChainById(chainId)
  if (!chain.multicallAddress) {
    throw new ServerError(
      `No multicall address configured for chainId ${chainId}.`
    )
  }

  const ownerAddress = await signer.getAddress()
  const calls: Array<MultiCallData> = []
  tokenData.map(({ token, approvalAddress }) => {
    calls.push({
      address: token.address,
      name: 'allowance',
      params: [ownerAddress, approvalAddress],
    })
  })

  const result = await fetchDataUsingMulticall(
    calls,
    ERC20_ABI,
    chainId,
    chain.multicallAddress
  )

  if (!result.length) {
    throw new ServerError(
      `Couldn't load allowance from chainId ${chainId} using multicall.`
    )
  }

  const parsedResult = result.map(({ data }) => ({
    approvalAmount: (data as BigNumber) ?? new BigNumber(0),
  }))

  return tokenData.map(({ token, approvalAddress }, i: number) => ({
    token,
    approvalAddress,
    approvedAmount: parsedResult[i].approvalAmount,
  }))
}

export const groupByChain = (
  tokenDataList: RevokeTokenData[]
): { [chainId: number]: RevokeTokenData[] } => {
  // group by chain
  const tokenDataByChain: { [chainId: number]: RevokeTokenData[] } = {}
  tokenDataList.forEach((tokenData) => {
    if (!tokenDataByChain[tokenData.token.chainId]) {
      tokenDataByChain[tokenData.token.chainId] = []
    }
    tokenDataByChain[tokenData.token.chainId].push(tokenData)
  })

  return tokenDataByChain
}
