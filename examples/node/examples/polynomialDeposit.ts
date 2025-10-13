import { findDefaultToken } from '@lifi/data-types'
import type { ContractCallsQuoteRequest, StatusResponse } from '@lifi/sdk'
import {
  ChainId,
  CoinKey,
  createClient,
  getContractCallsQuote,
  getStatus,
} from '@lifi/sdk'
import { EthereumProvider } from '@lifi/sdk-provider-ethereum'
import type { Address, Chain } from 'viem'
import {
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbi,
  publicActions,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrum, mainnet, optimism, polygon } from 'viem/chains'
import 'dotenv/config'
import { promptConfirm } from '../helpers/promptConfirm'
import { checkTokenAllowance } from './utils/checkTokenAllowance'
import { transformTxRequestToSendTxParams } from './utils/transformTxRequestToSendTxParams'

const run = async () => {
  console.info('>> Starting Polynomial Demo: Deposit sETH on Optimism')
  console.info('>> Initialize LiFi SDK')

  try {
    const privateKey = process.env.PRIVATE_KEY as Address

    // NOTE: Here we are using the private key to get the account,
    // but you can also use a Mnemonic account - see https://viem.sh/docs/accounts/mnemonic
    const account = privateKeyToAccount(privateKey)

    const client = createWalletClient({
      account,
      chain: arbitrum,
      transport: http(),
    }).extend(publicActions)

    const switchChains = [mainnet, arbitrum, optimism, polygon]

    const sdkClient = createClient({
      integrator: 'lifi-sdk-example',
    })
    sdkClient.setProviders([
      EthereumProvider({
        getWalletClient: () => Promise.resolve(client),
        switchChain: (chainId) =>
          Promise.resolve(
            createWalletClient({
              account,
              chain: switchChains.find(
                (chain) => chain.id === chainId
              ) as Chain,
              transport: http(),
            })
          ),
      }),
    ])

    // config for polynomial deposit run - https://docs.earn.polynomial.fi/technical-implementation/deposit
    const config = {
      // For polynomial deposit, quotes are available for optimism, ethereum, arbitrum or polygon
      fromChain: ChainId.ARB,
      // Polynomial Ethereum Contract is on OPT
      toChain: ChainId.OPT,
      fromToken: findDefaultToken(CoinKey.USDCe, ChainId.ARB).address,
      amount: '100000000000000', // sETH amount
      polynomialContractAddress: '0x2D46292cbB3C601c6e2c74C32df3A4FCe99b59C7', // Polynomial Ethereum Contract on Optimism
      polynomialContractToken: '0xE405de8F52ba7559f9df3C368500B6E6ae6Cee49', // sETH on Optimism
      polynomialContractGasLimit: '200000',
      polynomialContractAbi: [
        'function initiateDeposit(address user, uint amount) external',
      ],
    }

    const stakeTxData = encodeFunctionData({
      abi: parseAbi(config.polynomialContractAbi),
      functionName: 'initiateDeposit',
      args: [account.address, config.amount],
    })

    const contractCallsQuoteRequest: ContractCallsQuoteRequest = {
      fromChain: config.fromChain,
      fromToken: config.fromToken,
      fromAddress: account.address,
      toChain: config.toChain,
      toToken: config.polynomialContractToken,
      toAmount: config.amount,
      contractCalls: [
        {
          fromAmount: config.amount,
          fromTokenAddress: config.polynomialContractToken,
          toContractAddress: config.polynomialContractAddress,
          toContractCallData: stakeTxData,
          toContractGasLimit: config.polynomialContractGasLimit,
        },
      ],
    }
    console.info(
      '>> create contract calls quote request',
      contractCallsQuoteRequest
    )

    const contactCallsQuoteResponse = await getContractCallsQuote(
      sdkClient,
      contractCallsQuoteRequest
    )
    console.info('>> Contract Calls Quote', contactCallsQuoteResponse)

    if (!(await promptConfirm('Execute Quote?'))) {
      return
    }

    await checkTokenAllowance(
      sdkClient,
      contactCallsQuoteResponse,
      account,
      client
    )

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

      result = await getStatus(sdkClient, {
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
