import {
  TransactionReceipt,
  TransactionResponse,
} from '@ethersproject/providers'
import BigNumber from 'bignumber.js'
import { ethers } from 'ethers'
import { getArchiveRpcProvider } from '../../connectors'

import { ParsedReceipt } from '../../types'

// Swapped event for actually swapped token, but then a fee is deducted
// event Swapped(
//   bytes16 uuid,
//   address initiator,
//   address indexed beneficiary,
//   address indexed srcToken,
//   address indexed destToken,
//   uint256 srcAmount,
//   uint256 receivedAmount,
//   uint256 expectedAmount
// )
const swappedTypes: Array<ethers.utils.ParamType> = [
  ethers.utils.ParamType.from({
    indexed: false,
    internalType: 'bytes16',
    name: 'uuid',
    type: 'bytes16',
  }),
  ethers.utils.ParamType.from({
    indexed: false,
    internalType: 'address',
    name: 'initiator',
    type: 'address',
  }),
  ethers.utils.ParamType.from({
    indexed: false,
    internalType: 'uint256',
    name: 'srcAmount',
    type: 'uint256',
  }),
  ethers.utils.ParamType.from({
    indexed: false,
    internalType: 'uint256',
    name: 'receivedAmount',
    type: 'uint256',
  }),
  ethers.utils.ParamType.from({
    indexed: false,
    internalType: 'uint256',
    name: 'expectedAmount',
    type: 'uint256',
  }),
]
interface Swapped {
  initiator: string
  srcAmount: BigNumber
  receivedAmount: BigNumber
  expectedAmount: BigNumber
  referrer: string
}

const parseReceipt = async (
  tx: TransactionResponse,
  receipt: TransactionReceipt
): Promise<ParsedReceipt> => {
  const result = {
    fromAmount: '0',
    toAmount: '0',
    gasUsed: '0',
    gasPrice: '0',
    gasFee: '0',
  }

  // gas
  result.gasUsed = receipt.gasUsed.toString()
  result.gasPrice = tx.gasPrice?.toString() || '0'
  result.gasFee = receipt.gasUsed.mul(result.gasPrice).toString()

  // value
  result.fromAmount = tx.value.toString()

  // log
  const decoder = new ethers.utils.AbiCoder()
  // > swapped
  receipt.logs
    .filter((log) => log.address === receipt.to)
    .forEach((log) => {
      try {
        const parsed = decoder.decode(
          swappedTypes,
          log.data
        ) as unknown as Swapped
        result.fromAmount = parsed.srcAmount.toString()
        result.toAmount = parsed.receivedAmount.toString()
      } catch (e) {
        // find right log by trying to parse them
      }
    })

  // > transfer ERC20
  const abiTransfer = [
    'event Transfer(address indexed from, address indexed to, uint256 value)',
  ]
  const interfaceTransfer = new ethers.utils.Interface(abiTransfer)
  // > from user
  receipt.logs.forEach((log) => {
    try {
      const parsed = interfaceTransfer.parseLog(log)
      if (parsed.args['from'] === tx.from) {
        result.fromAmount = parsed.args['value'].toString()
      }
    } catch (e) {
      // find right log by trying to parse them
    }
  })
  // > to user
  receipt.logs.forEach((log) => {
    try {
      const parsed = interfaceTransfer.parseLog(log)
      if (parsed.args['to'] === tx.from) {
        result.toAmount = parsed.args['value'].toString()
      }
    } catch (e) {
      // find right log by trying to parse them
    }
  })

  // > transfer gas (POL)
  const abi = [
    `event LogTransfer(
        address indexed token,
        address indexed from,
        address indexed to,
        uint256 amount,
        uint256 input1,
        uint256 input2,
        uint256 output1,
        uint256 output2
  )`,
  ]
  const interfaceGas = new ethers.utils.Interface(abi)
  receipt.logs.forEach((log) => {
    try {
      const parsed = interfaceGas.parseLog(log)
      if (parsed.args['to'] === tx.from) {
        result.toAmount = parsed.args['amount'].toString()
      }
    } catch (e) {
      // find right log by trying to parse them
    }
  })

  // > try to load gas balance differences
  if (result.toAmount === '0') {
    try {
      const provider = getArchiveRpcProvider(tx.chainId)
      const providerBlockNumber = await provider.getBlockNumber()
      if (tx.blockNumber && providerBlockNumber) {
        const balanceBefore = await provider.getBalance(
          tx.from,
          tx.blockNumber - providerBlockNumber - 1
        )
        const balanceAfter = await provider.getBalance(
          tx.from,
          tx.blockNumber - providerBlockNumber
        )
        const balanceDiff = balanceAfter.sub(balanceBefore)
        const diffWithoutGas = balanceDiff.add(result.gasFee)
        if (!balanceDiff.isZero() && diffWithoutGas.gt(0)) {
          result.toAmount = diffWithoutGas.toString()
        }
      }
    } catch (e) {}
  }

  return result
}

export const openocean = {
  parseReceipt,
}
