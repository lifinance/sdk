import { NxtpSdk, NxtpSdkBase } from '@connext/nxtp-sdk'
import { getDeployedChainIdsForGasFee } from '@connext/nxtp-sdk/dist/transactionManager/transactionManager'
import TransactionManagerArtifact from '@connext/nxtp-contracts/artifacts/contracts/TransactionManager.sol/TransactionManager.json'
import { getChainData } from '@connext/nxtp-sdk/dist/utils'
import { Logger } from '@connext/nxtp-utils'
import { BigNumber, ethers, Signer } from 'ethers'
import {
  TransactionReceipt,
  TransactionResponse,
} from '@ethersproject/providers'
import { ParsedReceipt } from '../../types'

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
  data: {
    sendingChainId: number
    sendingAssetId: string
    receivingChainId: number
    receivingAssetId: string
    callData: string
    callTo: string
  }
): Promise<string> => {
  let calculateRelayerFee = '0'
  const chainIdsForPriceOracle = getDeployedChainIdsForGasFee()
  if (chainIdsForPriceOracle.includes(data.receivingChainId)) {
    const gasNeeded = await nxtpSDK.calculateGasFeeInReceivingTokenForFulfill(
      data.receivingChainId,
      data.receivingAssetId,
      data.callData,
      data.callTo
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
    toTokenAddress: toTokenAddress,
    gasUsed: '0',
    gasPrice: '0',
    gasFee: '0',
  }

  // gas
  result.gasUsed = receipt.gasUsed.toString()
  result.gasPrice = tx.gasPrice?.toString() || '0'
  result.gasFee = receipt.gasUsed.mul(result.gasPrice).toString()

  // logs
  // > TransactionFulfilled
  const interfaceFulfilled = new ethers.utils.Interface(
    TransactionManagerArtifact.abi
  )
  receipt.logs.forEach((log) => {
    try {
      const parsed = interfaceFulfilled.parseLog(log)
      const amount = parsed.args.args['txData']['amount'] as BigNumber
      const relayerFee = parsed.args.args['relayerFee'] as BigNumber
      const asset = parsed.args.args['txData']['receivingAssetId'] as string
      const transferred = amount.sub(relayerFee)

      result.toAmount = transferred.toString()
      result.toTokenAddress = asset.toLowerCase()
    } catch (e) {
      // find right log by trying to parse them
    }
  })

  // Fallback or Overwrite if swap happened
  // > transfer ERC20
  const abiTransfer = [
    'event Transfer(address indexed from, address indexed to, uint256 value)',
  ]
  const interfaceTransfer = new ethers.utils.Interface(abiTransfer)
  receipt.logs.forEach((log) => {
    try {
      const parsed = interfaceTransfer.parseLog(log)
      if (parsed.args['to'] === toAddress) {
        result.toAmount = parsed.args['value'].toString()
        result.toTokenAddress = log.address.toLowerCase()
      }
    } catch (e) {
      // find right log by trying to parse them
    }
  })

  return result
}

export default {
  setup,
  calculateRelayerFee,
  parseReceipt,
}
