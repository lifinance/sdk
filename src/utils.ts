import ERC20 from '@connext/nxtp-contracts/artifacts/contracts/interfaces/IERC20Minimal.sol/IERC20Minimal.json'
import { IERC20Minimal } from '@connext/nxtp-contracts/typechain'
import BigNumber from 'bignumber.js'
import { Contract, Signer } from 'ethers'

import { Step } from './types'

export const deepClone = (src: any) => {
  return JSON.parse(JSON.stringify(src))
}

export const sleep = (mills: number) => {
  return new Promise((resolve) => {
    setTimeout(resolve, mills)
  })
}

export const personalizeStep = async (
  signer: Signer,
  step: Step
): Promise<Step> => {
  if (step.action.toAddress && step.action.fromAddress) return step

  const address = await signer.getAddress()
  const fromAddress = step.action.fromAddress || address
  const toAddress = step.action.toAddress || address

  return {
    ...step,
    action: {
      ...step.action,
      fromAddress,
      toAddress,
    },
  }
}

export const getApproved = async (
  signer: Signer,
  tokenAddress: string,
  contractAddress: string
) => {
  const signerAddress = await signer.getAddress()
  const erc20 = new Contract(tokenAddress, ERC20.abi, signer) as IERC20Minimal

  try {
    const approved = await erc20.allowance(signerAddress, contractAddress)
    return new BigNumber(approved.toString())
  } catch (e) {
    return new BigNumber(0)
  }
}

export const setApproval = async (
  signer: Signer,
  tokenAddress: string,
  contractAddress: string,
  amount: string
  // eslint-disable-next-line max-params
) => {
  const erc20 = new Contract(tokenAddress, ERC20.abi, signer) as IERC20Minimal

  const tx = await erc20.approve(contractAddress, amount)
  return tx
}

export const splitListIntoChunks = <T>(list: T[], chunkSize: number): T[][] =>
  list.reduce((resultList: T[][], item, index) => {
    const chunkIndex = Math.floor(index / chunkSize)

    if (!resultList[chunkIndex]) {
      resultList[chunkIndex] = [] // start a new chunk
    }

    resultList[chunkIndex].push(item)

    return resultList
  }, [])
