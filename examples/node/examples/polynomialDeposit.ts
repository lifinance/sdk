import type { ContractCallsQuoteRequest, LiFiStep } from '@lifi/sdk'
import { ChainId, createConfig, EVM, getContractCallsQuote } from '@lifi/sdk'
import type { Address, Chain, PrivateKeyAccount } from 'viem'
import {
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbi,
  parseEther,
  publicActions,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet, arbitrum, optimism, polygon } from 'viem/chains'
import { promptConfirm } from '../helpers/promptConfirm'
import { executeCrossChainQuote } from './utils/executeCrossChainQuote'
import { WalletClientWithPublicActions } from './types'
import { AddressZero } from './constants'
import 'dotenv/config'

const sETH_OPT = '0xE405de8F52ba7559f9df3C368500B6E6ae6Cee49'
const POLYNOMIAL_ETHEREUM_CONTRACT_OPT =
  '0x2D46292cbB3C601c6e2c74C32df3A4FCe99b59C7'
const POLYNOMIAL_ABI = [
  'function initiateDeposit(address user, uint amount) external',
]
const POLYNOMIAL_GAS_LIMIT = '200000'

const getPolynomialQuote = async (
  fromChain: ChainId,
  fromToken: string,
  client: WalletClientWithPublicActions,
  userAddress: string,
  amount: string
): Promise<LiFiStep> => {
  const abi = parseAbi(POLYNOMIAL_ABI)

  const stakeTxData = encodeFunctionData({
    abi,
    functionName: 'initiateDeposit',
    args: [userAddress, amount],
  })

  const quoteRequest: ContractCallsQuoteRequest = {
    fromChain,
    fromToken,
    fromAddress: userAddress,
    toChain: ChainId.OPT,
    toToken: sETH_OPT,
    toAmount: amount,
    contractCalls: [
      {
        fromAmount: amount, // TODO: is this the right value? not sure what it should be
        fromTokenAddress: fromToken, // TODO: is this the right value? not sure what it should be
        toContractAddress: POLYNOMIAL_ETHEREUM_CONTRACT_OPT,
        toContractCallData: stakeTxData,
        toContractGasLimit: POLYNOMIAL_GAS_LIMIT,
      },
    ],
  }

  console.info('>> get contract calls quote', quoteRequest)

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
  const amount = parseEther('0.04').toString() // TODO: replace for this?

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
      client,
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
