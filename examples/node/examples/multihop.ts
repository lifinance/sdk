import * as lifiDataTypes from '@lifi/data-types'
import type {
  ContractCallsQuoteRequest,
  QuoteRequest,
  StatusResponse,
} from '@lifi/sdk'
import {
  ChainId,
  CoinKey,
  EVM,
  createConfig,
  getContractCallsQuote,
  getQuote,
  getStatus,
} from '@lifi/sdk'
import type { Address, Chain } from 'viem'
import { http, createWalletClient, fromHex, publicActions } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrum, mainnet, optimism, polygon } from 'viem/chains'
import 'dotenv/config'
import { promptConfirm } from '../helpers/promptConfirm'
import { checkTokenAllowance } from './utils/checkTokenAllowance'
import { transformTxRequestToSendTxParams } from './utils/transformTxRequestToSendTxParams'

const { findDefaultToken } = (lifiDataTypes as any).default

const run = async () => {
  console.info('>> Starting Multihop demo - route USDC.ARB to USDC.OPT')

  try {
    console.info('>> Initialize LiFi SDK')
    const privateKey = process.env.PRIVATE_KEY as Address

    // NOTE: Here we are using the private key to get the account,
    // but you can also use a Mnemonic account - see https://viem.sh/docs/accounts/mnemonic
    const account = privateKeyToAccount(privateKey)

    const client = createWalletClient({
      account,
      chain: arbitrum,
      transport: http(),
    }).extend(publicActions)

    const switchChains = [mainnet, arbitrum, optimism, polygon] as Chain[]

    createConfig({
      integrator: 'lifi-sdk-example',
      providers: [
        EVM({
          getWalletClient: () => Promise.resolve(client),
          switchChain: (chainId) =>
            Promise.resolve(
              createWalletClient({
                account,
                chain: switchChains.find((chain) => {
                  if (chain.id === chainId) {
                    return chain
                  }
                }) as Chain,
                transport: http(),
              })
            ),
        }),
      ],
    })

    // config for multihop run
    const config = {
      fromChain: ChainId.ARB, // Arbitrum
      fromToken: findDefaultToken(CoinKey.USDC, ChainId.ARB).address, // USDC ARB
      intermediateChain: ChainId.POL, // Polygon
      intermediateToken: findDefaultToken(CoinKey.USDC, ChainId.POL).address, // USDC POL
      toChain: ChainId.OPT, // Optimism
      toToken: findDefaultToken(CoinKey.USDC, ChainId.OPT).address, // USDC OPT
      amount: '100000', // USDC
    }

    const secondBridgeQuoteRequest: QuoteRequest = {
      fromChain: config.intermediateChain,
      fromToken: config.intermediateToken,
      fromAmount: config.amount,
      toChain: config.toChain,
      toToken: config.toToken,
      fromAddress: account.address, // will actually be a relayer
      allowBridges: ['hop', 'stargate', 'across', 'amarok'],
      maxPriceImpact: 0.4,
    }

    console.info(
      '>> created second bridge quote request',
      secondBridgeQuoteRequest
    )

    const secondBridgeQuote = await getQuote(secondBridgeQuoteRequest)
    console.info('>> got second quote', secondBridgeQuote)

    const quoteRequest: ContractCallsQuoteRequest = {
      fromChain: config.fromChain,
      fromToken: config.fromToken,
      fromAddress: account.address,
      toChain: secondBridgeQuote.action.fromChainId,
      toToken: secondBridgeQuote.action.fromToken.address,
      toAmount: secondBridgeQuote.action.fromAmount,
      contractCalls: [
        {
          fromAmount: secondBridgeQuote.action.fromAmount,
          fromTokenAddress: secondBridgeQuote.action.fromToken.address,
          toContractAddress: secondBridgeQuote.transactionRequest!.to!,
          toContractCallData:
            secondBridgeQuote.transactionRequest!.data!.toString(),
          toContractGasLimit: fromHex(
            secondBridgeQuote.transactionRequest!.gasLimit!.toString() as Address,
            'bigint'
          ).toString(),
        },
      ],
    }

    console.info('>> get contract calls quote', quoteRequest)

    const contactCallsQuoteResponse = await getContractCallsQuote(quoteRequest)

    console.info(
      '>> got contract calls quote response',
      contactCallsQuoteResponse
    )

    if (!(await promptConfirm('Execute Quote?'))) {
      return
    }

    await checkTokenAllowance(contactCallsQuoteResponse, account, client)

    console.info(
      '>> Execute transaction',
      contactCallsQuoteResponse.transactionRequest
    )

    const hash = await client.sendTransaction(
      transformTxRequestToSendTxParams(
        client.account,
        contactCallsQuoteResponse.transactionRequest
      )
    )

    console.info('>> Transaction sent', hash)

    const receipt = await client.waitForTransactionReceipt({
      hash,
    })

    console.info('>> Transaction receipt', receipt)

    // wait for execution
    let result: StatusResponse
    do {
      await new Promise((res) => {
        setTimeout(() => {
          res(null)
        }, 5000)
      })

      result = await getStatus({
        txHash: receipt.transactionHash,
        bridge: contactCallsQuoteResponse.tool,
        fromChain: contactCallsQuoteResponse.action.fromChainId,
        toChain: contactCallsQuoteResponse.action.toChainId,
      })

      console.info('>> Status update', result)
    } while (result.status !== 'DONE' && result.status !== 'FAILED')

    console.info('>> DONE', result)
  } catch (e) {
    console.error(e)
  }
}

run()
