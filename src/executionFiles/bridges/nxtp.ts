import { NxtpSdk, NxtpSdkBase } from '@connext/nxtp-sdk'
import { getDeployedChainIdsForGasFee } from '@connext/nxtp-sdk/dist/transactionManager/transactionManager'
import { getChainData } from '@connext/nxtp-sdk/dist/utils'
import { Logger } from '@connext/nxtp-utils'
import { ethers, Signer } from 'ethers'
import {
  TransactionReceipt,
  TransactionResponse,
} from '@ethersproject/providers'
import { ParsedReceipt } from '../../types'

const transferAbi = [
  'event Transfer (address indexed from, address indexed to, uint256 value)',
  'event ContractFallbackCallFailed(address from, address to, uint256 value)',
]

// TODO: move in sdk setup, avoid accessing env variabels
// Add overwrites to specific chains here. They will only be applied if the chain is used.
const getChainConfigOverwrites = () => {
  try {
    return JSON.parse(process.env.REACT_APP_NXTP_OVERWRITES_JSON!)
  } catch (e) {
    return {}
  }
}
const chainConfigOverwrites: {
  [chainId: number]: {
    transactionManagerAddress?: string
    subgraph?: string[]
    subgraphSyncBuffer?: number
  }
} = getChainConfigOverwrites()

const setup = async (
  signer: Signer,
  chainProviders: Record<number, string[]>
): Promise<{ sdk: NxtpSdk; sdkBase: NxtpSdkBase }> => {
  const chainConfig: Record<
    number,
    {
      providers: string[]
      subgraph?: string[]
      transactionManagerAddress?: string
      subgraphSyncBuffer?: number
    }
  > = {}
  Object.entries(chainProviders).forEach(([chainId, providers]) => {
    chainConfig[parseInt(chainId)] = {
      providers: providers,
      subgraph: chainConfigOverwrites[parseInt(chainId)]?.subgraph,
      transactionManagerAddress:
        chainConfigOverwrites[parseInt(chainId)]?.transactionManagerAddress,
      subgraphSyncBuffer:
        chainConfigOverwrites[parseInt(chainId)]?.subgraphSyncBuffer,
    }
  })
  const chainData = await getChainData()

  const sdkBase = new NxtpSdkBase({
    chainConfig,
    signerAddress: signer.getAddress(),
    // signer?: Signer
    // messagingSigner?: Signer
    logger: new Logger({ name: 'NxtpSdkBase', level: 'error' }),
    // network?: "testnet" | "mainnet" | "local"
    // natsUrl?: string
    // authUrl?: string
    // messaging?: UserNxtpNatsMessagingService
    skipPolling: false,
  })

  const sdk = new NxtpSdk({
    chainConfig,
    signer,
    // messagingSigner?: Signer
    logger: new Logger({ name: 'NxtpSdk', level: 'error' }),
    // network?: "testnet" | "mainnet" | "local"
    // natsUrl?: string
    // authUrl?: string
    // messaging?: UserNxtpNatsMessagingService
    // skipPolling?: boolean
    sdkBase,
    chainData,
  })

  return { sdk, sdkBase } // TODO try to remove "big" sdk
}

const calculateRelayerFee = async (
  nxtpSDK: NxtpSdkBase,
  preparedTransaction: {
    txData: {
      sendingChainId: number
      sendingAssetId: string
      receivingChainId: number
      receivingAssetId: string
    }
  }
): Promise<string> => {
  let calculateRelayerFee = '0'
  const chainIdsForPriceOracle = getDeployedChainIdsForGasFee()
  if (
    chainIdsForPriceOracle.includes(preparedTransaction.txData.receivingChainId)
  ) {
    const gasNeeded = await nxtpSDK.calculateGasFeeInReceivingTokenForFulfill(
      preparedTransaction.txData.receivingChainId,
      preparedTransaction.txData.receivingAssetId
    )

    calculateRelayerFee = gasNeeded.toString()
  }

  return calculateRelayerFee
}

const parseReceipt = (
  toAddress: string,
  toTokenAddress: string,
  tx: TransactionResponse,
  receipt: TransactionReceipt
): ParsedReceipt => {
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

  //log
  const iface = new ethers.utils.Interface(transferAbi)
  const transferLogs = receipt.logs.filter(
    (log) => log.address.toLowerCase() === toTokenAddress.toLowerCase()
  )

  const parsedLogs = transferLogs.map((log) => iface.parseLog(log!))
  const relevantLogs = parsedLogs.filter(
    (log) => log.args[1].toLowerCase() === toAddress.toLowerCase()
  )

  const valueSum = relevantLogs.reduce(
    (sum, current) => sum.add(current.args[2]),
    ethers.BigNumber.from('0')
  )

  result.toAmount = valueSum.toString()

  return result
}

export default {
  setup,
  calculateRelayerFee,
  parseReceipt,
}
