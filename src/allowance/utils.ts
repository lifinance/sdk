import { Contract, ContractTransaction, Signer } from 'ethers'
import BigNumber from 'bignumber.js'
import { ERC20_ABI, ERC20Contract, RevokeTokenData } from '../types'
import { ChainId, multicallAddresses, Token } from '@lifinance/types'
import { fetchDataUsingMulticall, MultiCallData } from '../utils/multicall'
import { ServerError } from '../utils/errors'

export const getApproved = async (
  signer: Signer,
  tokenAddress: string,
  contractAddress: string
): Promise<BigNumber> => {
  const signerAddress = await signer.getAddress()
  const erc20 = new Contract(tokenAddress, ERC20_ABI, signer) as ERC20Contract

  try {
    const approved = await erc20.allowance(signerAddress, contractAddress)
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
  const multicallAddress = multicallAddresses[chainId]
  if (!multicallAddress) {
    throw new ServerError(
      'No multicall address configured for chainId ' + chainId
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
    multicallAddress
  )

  if (!result.length) {
    throw new ServerError(
      `Could not load allowance from chainId ${chainId} using multicall`
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
