import type { ContractCallQuoteRequest, LiFiStep } from '@lifi/sdk'
import { createConfig, ChainId, EVM, getContractCallsQuote } from '@lifi/sdk'
import { ethers } from 'ethers'
import { promptConfirm } from '../helpers'
import type { PrivateKeyAccount, Address, Chain } from 'viem'
import { createWalletClient, http, publicActions, parseEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet, arbitrum, optimism, polygon } from 'viem/chains'
import { WalletClientWithPublicActions } from './types'
import { executeCrossChainQuote } from './utils/executeCrossChainQuote'
import { AddressZero } from './constants'

const getKlimaQuote = async (
  fromChain: ChainId,
  fromToken: string,
  client: WalletClientWithPublicActions,
  userAddress: string,
  retireAmount: string
): Promise<LiFiStep> => {
  const USDC_POL = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'
  const BCT_POL = '0x2F800Db0fdb5223b3C3f354886d907A671414A7F'

  // https://docs.klimadao.finance/developers/contracts/retirement/v2-diamond/generalized-retirement
  const KLIMA_ETHEREUM_CONTRACT_OPT =
    '0x8cE54d9625371fb2a068986d32C85De8E6e995f8'
  const KLIMA_ABI = [
    'function getSourceAmountDefaultRetirement(address,address,uint256) external view returns (uint256 amountIn)',
    'function retireExactCarbonDefault(address, address, uint256, uint256, string, address, string, string, uint8)',
  ]
  const KLIMA_GAS_LIMIT = '1300000'

  // setup contract
  const provider = await getLifi().getRpcProvider(ChainId.POL) // TODO: question: what to replace this with

  const contract = new ethers.Contract( // TODO: question: how do we do this without ethers?
    KLIMA_ETHEREUM_CONTRACT_OPT,
    KLIMA_ABI,
    provider
  )

  // get usdc amount
  const getUsdcAmountResult = await contract.getSourceAmountDefaultRetirement(
    USDC_POL, // address sourceToken,
    BCT_POL, // address poolToken,
    retireAmount // uint256 retireAmount,
  )

  // viem version?
  // const getUsdcAmountResult = await client.readContract({
  //   address: KLIMA_ETHEREUM_CONTRACT_OPT,
  //   abi: KLIMA_ABI,
  //   functionName: 'getSourceAmountDefaultRetirement',
  //   args: [
  //     USDC_POL, // address sourceToken,
  //     BCT_POL, // address poolToken,
  //     retireAmount, // uint256 retireAmount,
  //   ],
  // })

  const usdcAmount = getUsdcAmountResult.toString()

  // TODO: how to do this with viem?
  // contract call
  const retireTx = await contract.populateTransaction.retireExactCarbonDefault(
    USDC_POL, // address sourceToken,
    BCT_POL, // address poolToken,
    usdcAmount, // uint256 maxAmountIn,
    retireAmount, // uint256 retireAmount,
    'LI.FI', // string memory retiringEntityString,
    '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0', // address beneficiaryAddress,
    'LI.FI', // string memory beneficiaryString,
    'Cross Chain Contract Calls', // string memory retirementMessage,
    0 // LibTransfer.From fromMode
  )

  // quote
  const quoteRequest: ContractCallQuoteRequest = {
    fromChain,
    fromToken,
    fromAddress: userAddress,
    toChain: ChainId.POL,
    toToken: USDC_POL,
    toAmount: usdcAmount,
    toContractAddress: retireTx.to!,
    toContractCallData: retireTx.data!,
    toContractGasLimit: KLIMA_GAS_LIMIT,
  }

  // TODO: Should be ContractCallsQuoteRequest?
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
  console.info('>> Klima Retire Demo: Retire(burn) Carbon tokens to offset CO2')

  const privateKey = process.env.PRIVATE_KEY as Address

  // NOTE: Here we are using the private key to get the account,
  // but you can also use a Mnemonic account - see https://viem.sh/docs/accounts/mnemonic
  const account = privateKeyToAccount(privateKey)

  console.info('>> Initialize LiFi SDK')
  const client = setUpSDK(account)

  // config
  const fromChain = ChainId.OPT
  const fromToken = AddressZero
  const retireAmount = parseEther('1').toString()

  try {
    // get quote
    const quote = await getKlimaQuote(
      fromChain,
      fromToken,
      client,
      account.address,
      retireAmount
    )
    console.log('Quote', quote)

    // continue?
    if (!(await promptConfirm('Execute Quote?'))) {
      return
    }

    // execute quote
    // await executeCrossChainQuote(signer, quote) // TODO: use new version as with Multihop
    await executeCrossChainQuote(client, account.address, quote)
  } catch (e) {
    console.error(e)
  }
}

run()
