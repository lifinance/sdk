import { Fragment, Interface, JsonFragment } from '@ethersproject/abi'
import { Contract } from '@ethersproject/contracts'
import { getRpcProvider } from '../connectors'
import { Bytes } from 'ethers'
import { splitListIntoChunks } from './utils'

const MAX_MULTICALL_SIZE = 100

export const MULTICALL_ABI = [
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

export type MultiCallData = {
  address: string
  name: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: any[]
}

export const fetchDataUsingMulticall = async (
  calls: Array<MultiCallData>,
  abi: ReadonlyArray<Fragment | JsonFragment | string>,
  chainId: number,
  multicallAddress: string
): Promise<{ data: unknown; blockNumber: number }[]> => {
  // 1. create contract using multicall contract address and abi...
  const multicallContract = new Contract(
    multicallAddress,
    MULTICALL_ABI,
    getRpcProvider(chainId)
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
        const { returnData, blockNumber } = await multicallContract.aggregate(
          callData
        )
        // 4. decode bytes array to useful data array...
        return returnData
          .map((call: Bytes, i: number) =>
            abiInterface.decodeFunctionResult(calls[i].name, call)
          )
          .map((data: [unknown]) => {
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
