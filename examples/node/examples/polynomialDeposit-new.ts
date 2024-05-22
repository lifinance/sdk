import type { ContractCallQuoteRequest, LiFiStep } from '@lifi/sdk'
import {
  ChainId,
  ContractCallsQuoteRequest,
  createConfig,
  EVM,
  getContractCallsQuote,
} from '@lifi/sdk'
import { ethers } from 'ethers'
import { promptConfirm } from '../helpers'
import type { PrivateKeyAccount, Address, Chain } from 'viem'
import { createWalletClient, fromHex, http, publicActions } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet, arbitrum, optimism, polygon } from 'viem/chains'
import { WalletClientWithPublicActions } from './types'
import { executeCrossChainQuote } from './utils/executeCrossChainQuote'
import { AddressZero } from './constants'

const getPolynomialQuote = async (
  fromChain: ChainId,
  fromToken: string,
  userAddress: string,
  amount: string
): Promise<LiFiStep> => {
  const sETH_OPT = '0xE405de8F52ba7559f9df3C368500B6E6ae6Cee49'
  const POLYNOMIAL_ETHEREUM_CONTRACT_OPT =
    '0x2D46292cbB3C601c6e2c74C32df3A4FCe99b59C7'
  const POLYNOMIAL_ABI = [
    'function initiateDeposit(address user, uint amount) external',
  ]
  const POLYNOMIAL_GAS_LIMIT = '200000'

  // contract call
  const contract = new ethers.Contract( // TODO: question: how do we do this without ethers?
    POLYNOMIAL_ETHEREUM_CONTRACT_OPT,
    POLYNOMIAL_ABI
  )
  const stakeTx = await contract.populateTransaction.initiateDeposit(
    userAddress,
    amount
  )

  // quote
  const quoteRequest: ContractCallQuoteRequest = {
    fromChain,
    fromToken,
    fromAddress: userAddress,
    toChain: ChainId.OPT,
    toToken: sETH_OPT,
    toAmount: amount,
    toContractAddress: stakeTx.to!,
    toContractCallData: stakeTx.data!,
    toContractGasLimit: POLYNOMIAL_GAS_LIMIT,
  }

  // Should be ContractCallsQuoteRequest
  // const quoteRequest: ContractCallsQuoteRequest = {
  //   fromChain,
  //   fromToken,
  //   fromAddress: address,
  //   toChain: secondBridgeQuote.action.fromChainId,
  //   toToken: secondBridgeQuote.action.fromToken.address,
  //   toAmount: secondBridgeQuote.action.fromAmount,
  //   contractCalls: [
  //     {
  //       fromAmount: secondBridgeQuote.action.fromAmount,
  //       fromTokenAddress: secondBridgeQuote.action.fromToken.address,
  //       toContractAddress: secondBridgeQuote.transactionRequest!.to!,
  //       toContractCallData:
  //         secondBridgeQuote.transactionRequest!.data!.toString(),
  //       toContractGasLimit: fromHex(
  //         secondBridgeQuote.transactionRequest!.gasLimit!.toString() as Address,
  //         'bigint'
  //       ).toString(),
  //     },
  //   ],
  // }

  console.info('>> get contract calls quote', quoteRequest)

  // return getLifi().getContractCallQuote(quoteRequest)
  return getContractCallsQuote(quoteRequest)
}

// TODO: look at code reuse when all examples finished
const setUpSDK = (account: PrivateKeyAccount) => {
  const client = createWalletClient({
    account,
    chain: mainnet,
    transport: http(),
  }).extend(publicActions)

  // We need to perform operations on multiple chains
  // The switch chain function below facilitates this
  const chains = [mainnet, arbitrum, optimism, polygon]

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
              }) as Chain,
              transport: http(),
            })
          ),
      }),
    ],
  })

  return client
}

const run = async () => {
  console.info('>> Polynomial Demo: Deposit sETH on Optimism')

  // config
  const fromChain = ChainId.ETH
  const fromToken = AddressZero
  const amount = ethers.utils.parseEther('0.04').toString() // TODO: replace for this?

  try {
    const privateKey = process.env.PRIVATE_KEY as Address

    // NOTE: Here we are using the private key to get the account,
    // but you can also use a Mnemonic account - see https://viem.sh/docs/accounts/mnemonic
    const account = privateKeyToAccount(privateKey)

    console.info('>> Initialize LiFi SDK')
    const client = setUpSDK(account)
    // get quote
    const quote = await getPolynomialQuote(
      fromChain,
      fromToken,
      account.address,
      amount
    )
    console.log('Quote', quote)

    // continue?
    if (!(await promptConfirm('Execute Quote?'))) {
      return
    }

    // execute quote
    await executeCrossChainQuote(client, account.address, quote)
  } catch (e) {
    console.error(e)
  }
}

run()
