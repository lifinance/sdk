import { Fragment, Interface, JsonFragment } from '@ethersproject/abi'
import { Contract } from '@ethersproject/contracts'
import { getRpcProvider } from '../connectors'
import { BigNumber, Bytes } from 'ethers'
import { splitListIntoChunks } from './utils'
import MULTICALL_ABI from './multicallAbi.json'

const MAX_MULTICALL_SIZE = 100

export type MultiCallData = {
  address: string
  name: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: any[]
}

type MultiCallAggregateResult = {
  blockNumber: BigNumber
  returnData: { success: boolean; returnData: Bytes }[]
}

export const fetchDataUsingMulticall = async (
  calls: Array<MultiCallData>,
  abi: ReadonlyArray<Fragment | JsonFragment | string>,
  chainId: number,
  multicallAddress: string,
  requireSuccess = false
): Promise<{ data: unknown; blockNumber: number }[]> => {
  // 1. create contract using multicall contract address and abi...
  const provider = await getRpcProvider(chainId)
  const multicallContract = new Contract(
    multicallAddress,
    MULTICALL_ABI,
    provider
  )
  const abiInterface = new Interface(abi)

  // split up lists into chunks to stay below multicall limit
  const chunkedList = splitListIntoChunks<MultiCallData>(
    calls,
    MAX_MULTICALL_SIZE
  )

  const chunkedResults = await Promise.all(
    chunkedList.map(async (chunkedCalls) => {
      const callData = chunkedCalls.map((call) => [
        call.address.toLowerCase(),
        abiInterface.encodeFunctionData(call.name, call.params),
      ])

      try {
        // 3. get bytes array from multicall contract by process aggregate method...
        const { blockNumber, returnData }: MultiCallAggregateResult =
          await multicallContract.tryBlockAndAggregate(requireSuccess, callData)
        // 4. decode bytes array to useful data array...
        return returnData
          .map(({ success, returnData }, i: number) => {
            if (success) {
              return abiInterface.decodeFunctionResult(
                chunkedCalls[i].name,
                returnData
              )
            } else {
              console.error(
                `Multicall failed for address "${chunkedCalls[i].address}" and function "${chunkedCalls[i].name}" on chainId "${chainId}"`
              )
              return []
            }
          })
          .map((data) => {
            return {
              data: data[0],
              blockNumber: blockNumber.toNumber(),
            }
          })
      } catch (e) {
        return []
      }
    })
  )

  return chunkedResults.flat()
}
