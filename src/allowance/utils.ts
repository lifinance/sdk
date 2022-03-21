import { Contract, ContractTransaction, Signer } from 'ethers'
import BigNumber from 'bignumber.js'
import { ERC20_ABI, ERC20Contract } from '../types'

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
