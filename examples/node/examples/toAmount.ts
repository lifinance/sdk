import * as lifiDataTypes from '@lifi/data-types'
import type { ContractCallsQuoteRequest, StatusResponse } from '@lifi/sdk'
import {
  ChainId,
  CoinKey,
  EVM,
  createConfig,
  getContractCallsQuote,
  getStatus,
} from '@lifi/sdk'
import type { Address, Chain } from 'viem'
import { http, createWalletClient, publicActions } from 'viem'
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

    // config for toAmount run
    const config = {
      fromChain: ChainId.ARB, // Arbitrum
      fromToken: findDefaultToken(CoinKey.USDC, ChainId.ARB).address, // USDC ARB
      toChain: ChainId.OPT, // Optimism
      toToken: findDefaultToken(CoinKey.USDC, ChainId.OPT).address, // USDC OPT
      toAmount: '1000000', // 1 USDC
    }

    const quoteRequest: ContractCallsQuoteRequest = {
      fromChain: config.fromChain,
      fromToken: config.fromToken,
      fromAddress: account.address,
      toChain: config.toChain,
      toToken: config.toToken,
      toAmount: config.toAmount,
      contractCalls: [],
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
