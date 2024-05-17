//error
import type { ContractCallQuoteRequest, LiFiStep } from '@lifi/sdk'
import * as lifiDataTypes from '@lifi/data-types'
import {
  createConfig,
  EVM,
  CoinKey,
  ChainId,
  getQuote,
  getContractCallsQuote,
  getTokenAllowance, // TODO: question: not exported. use something else? getTokenBalance?
  setTokenApproval, // TODO: question: doesn't exist any more?
} from '@lifi/sdk'
import { promptConfirm } from '../helpers/promptConfirm'
import type { PrivateKeyAccount, Address } from 'viem'
import { createWalletClient, http } from 'viem'

import { mainnet, arbitrum, gnosis, polygon } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { BigNumber, ethers, Signer } from 'ethers'
import 'dotenv/config'

const dataTypes = (lifiDataTypes as any).default
interface GetMultihopQuoteParams {
  fromChain: ChainId
  fromToken: string
  toChain: ChainId
  toToken: string
  amount: string
  address: string
}

const getMultihopQuote = async ({
  fromChain,
  fromToken,
  toChain,
  toToken,
  amount,
  address,
}: GetMultihopQuoteParams): Promise<LiFiStep> => {
  // Get bridge route from polygon to destination chain
  const secondBridgeQuoteRequest = {
    fromChain: ChainId.POL, // polygon
    fromToken: dataTypes.findDefaultToken(CoinKey.USDC, ChainId.POL), // USDC on polygon
    fromAmount: amount,
    toChain,
    toToken,
    fromAddress: address, // will actually be a relayer
    toAddress: address,
    allowBridges: ['hop'],
  }

  console.info(
    '>> created second bridge quote request',
    secondBridgeQuoteRequest
  )

  const secondBridgeQuote = await getQuote(secondBridgeQuoteRequest)
  console.info('>> got second quote', secondBridgeQuote)

  // quote
  const quoteRequest: ContractCallQuoteRequest = {
    fromChain,
    fromToken,
    fromAddress: address,
    toChain: secondBridgeQuote.action.fromChainId,
    toToken: secondBridgeQuote.action.fromToken.address,
    toAmount: secondBridgeQuote.action.fromAmount,
    toContractAddress: secondBridgeQuote.transactionRequest!.to!,
    toContractCallData: secondBridgeQuote.transactionRequest!.data!.toString(),
    toContractGasLimit:
      secondBridgeQuote.transactionRequest!.gasLimit!.toString(),
  }

  console.info('>> get contract calls quote')
  // return getContractCallsQuote(quoteRequest) // TODO: get this working
}

// TODO: look at reuse once all examples are done
const executeCrossChainQuote = async (address: string, quote: LiFiStep) => {
  // Approval
  if (quote.action.fromToken.address !== ethers.constants.AddressZero) {
    // TODO: question: has the code work flow or this changed? getTokenAllowance
    //  isn't availible and setTokenApproval isn't availible
    // TODO: question: getTokenAllowance seems to exist in SDK but isn't exported?
    const approval = await getTokenAllowance(
      quote.action.fromToken,
      address,
      quote.estimate.approvalAddress
    )
    // check approval
    if (!approval) {
      throw 'Failed to load approval'
    }

    // set approval
    if (BigNumber.from(approval).lt(quote.action.fromAmount)) {
      await setTokenApproval({
        // TODO: question: setTokenApproval method doesn't exist anymore in the sdk
        signer,
        token: quote.action.fromToken,
        amount: quote.action.fromAmount,
        approvalAddress: quote.estimate.approvalAddress,
      })
    }
  }
}

// TODO: look at code reuse when all examples finished
const setUpSDK = (account: PrivateKeyAccount) => {
  const client = createWalletClient({
    account,
    chain: mainnet,
    transport: http(),
  })

  // We need to perform operations on multiple chains
  // The switch chain function below facilitates this
  const chains = [mainnet, arbitrum, gnosis, polygon]

  createConfig({
    integrator: 'lifi-sdk-example',
    providers: [
      EVM({
        getWalletClient: () => Promise.resolve(client),
        switchChain: (chainId) =>
          Promise.resolve(
            createWalletClient({
              account,
              chain: chains.find((chain) => {
                if (chain.id == chainId) {
                  return chain
                }
              }),
              transport: http(),
            })
          ),
      }),
    ],
  })
}

const run = async () => {
  try {
    const privateKey = process.env.PRIVATE_KEY as Address

    console.log('privateKey', privateKey)

    // NOTE: Here we are using the private key to get the account,
    // but you can also use a Mnemonic account - see https://viem.sh/docs/accounts/mnemonic
    const account = privateKeyToAccount(privateKey)

    console.info('>> Initialize LiFi SDK')
    setUpSDK(account)

    const quoteConfig = {
      fromChain: ChainId.AVA,
      fromToken: dataTypes.findDefaultToken(CoinKey.USDC, ChainId.AVA), // USDC on avalanche
      toChain: ChainId.DAI,
      toToken: dataTypes.findDefaultToken(CoinKey.DAI, ChainId.DAI),
      amount: '100000', // 1 usd
      address: account.address,
    }

    // get quote
    const multiHopQuote = await getMultihopQuote(quoteConfig)
    console.info('>> got multihop quote', multiHopQuote)

    // continue?
    if (!(await promptConfirm('Execute Quote?'))) {
      return
    }

    // execute quote
    // await executeCrossChainQuote(signer, multiHopQuote)
    // TODO: question: should I output something here? is anything returned?
    console.info('>> Done')
  } catch (e) {
    console.error(e)
  }
}

console.info('>> Starting Multihop demo - route USDC.AVA to DAI.DAI')

run()
