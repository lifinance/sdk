import * as lifiDataTypes from '@lifi/data-types'
import type {
  ContractCallsQuoteRequest,
  QuoteRequest,
  StatusResponse,
} from '@lifi/sdk'
import {
  CoinKey,
  ChainId,
  getQuote,
  getContractCallsQuote,
  createConfig,
  EVM,
  getTokenAllowance,
  setTokenAllowance,
  getStatus,
} from '@lifi/sdk'
import type { Address, Chain, Hash } from 'viem'
import { createWalletClient, fromHex, http, publicActions } from 'viem'
import { mainnet, arbitrum, optimism, polygon } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { AddressZero } from './constants'
import 'dotenv/config'
import { promptConfirm } from '../helpers/promptConfirm'

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

    // configure
    const fromChain = ChainId.ARB
    const fromToken = findDefaultToken(CoinKey.USDC, ChainId.ARB).address
    const toChain = ChainId.OPT
    const toToken = findDefaultToken(CoinKey.USDC, ChainId.OPT).address
    const amount = '100000' // 1 usd

    const secondBridgeQuoteRequest: QuoteRequest = {
      fromChain: ChainId.POL,
      fromToken: findDefaultToken(CoinKey.USDC, ChainId.POL).address,
      fromAmount: amount,
      toChain,
      toToken,
      fromAddress: account.address, // will actually be a relayer
      // allowBridges: ['hop', 'across', 'amarok'],
      // denyBridges: ['stargate'],
      maxPriceImpact: 0.4,
    }

    console.info(
      '>> created second bridge quote request',
      secondBridgeQuoteRequest
    )

    const secondBridgeQuote = await getQuote(secondBridgeQuoteRequest)
    console.info('>> got second quote', secondBridgeQuote)

    // quote
    const quoteRequest: ContractCallsQuoteRequest = {
      fromChain,
      fromToken,
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

    if (contactCallsQuoteResponse.action.fromToken.address !== AddressZero) {
      const approval = await getTokenAllowance(
        contactCallsQuoteResponse.action.fromToken,
        account.address,
        contactCallsQuoteResponse.estimate.approvalAddress
      )

      // set approval if needed
      if (approval < BigInt(contactCallsQuoteResponse.action.fromAmount)) {
        const txHash = await setTokenAllowance({
          walletClient: client,
          spenderAddress: contactCallsQuoteResponse.estimate.approvalAddress,
          token: contactCallsQuoteResponse.action.fromToken,
          amount: BigInt(contactCallsQuoteResponse.action.fromAmount),
        })

        if (txHash) {
          const transactionReceipt = await client.waitForTransactionReceipt({
            hash: txHash,
            retryCount: 20,
            retryDelay: ({ count }: { count: number; error: Error }) =>
              Math.min(~~(1 << count) * 200, 3000),
          })

          console.info(
            `>> Set Token Allowance - transaction complete: amount: ${contactCallsQuoteResponse.action.fromToken} txHash: ${transactionReceipt.transactionHash}.`
          )
        }
      }
    }

    const transactionRequest = contactCallsQuoteResponse.transactionRequest

    console.info('>> Execute transaction', transactionRequest)

    const { maxFeePerGas, maxPriorityFeePerGas } =
      await client.estimateFeesPerGas()

    console.log(
      'viem maxFeePerGas, maxPriorityFeePerGas',
      maxFeePerGas,
      maxPriorityFeePerGas
    )

    console.log(
      'out gasPrice',
      transactionRequest.gasPrice
        ? BigInt(transactionRequest.gasPrice as string)
        : undefined
    )

    const hash = await client.sendTransaction({
      to: transactionRequest.to as Address,
      account: client.account!,
      value: transactionRequest.value ? transactionRequest.value : undefined,
      data: transactionRequest.data as Hash,
      gas: transactionRequest.gasLimit
        ? BigInt(transactionRequest.gasLimit as string)
        : undefined,
      // gasPrice: transactionRequest.gasPrice
      //   ? BigInt(transactionRequest.gasPrice as string)
      //   : undefined,
      maxFeePerGas,
      maxPriorityFeePerGas,
      chain: null,
    } as any)

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
