import type { ContractCallsQuoteRequest, StatusResponse } from '@lifi/sdk'
import {
  ChainId,
  createConfig,
  EVM,
  getContractCallsQuote,
  getStatus,
} from '@lifi/sdk'
import type { Address, Chain } from 'viem'
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
import 'dotenv/config'
import { promptConfirm } from '../helpers/promptConfirm'
import { AddressZero } from './constants'
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
      chain: mainnet,
      transport: http(),
    }).extend(publicActions)

    const switchChains = [mainnet, arbitrum, optimism, polygon]

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
    const fromChain = ChainId.ETH
    const fromToken = AddressZero
    const amount = parseEther('0.04').toString()
    const sETH_OPT = '0xE405de8F52ba7559f9df3C368500B6E6ae6Cee49'
    const POLYNOMIAL_ETHEREUM_CONTRACT_OPT =
      '0x2D46292cbB3C601c6e2c74C32df3A4FCe99b59C7'
    const POLYNOMIAL_GAS_LIMIT = '200000'
    const POLYNOMIAL_ABI = [
      'function initiateDeposit(address user, uint amount) external',
    ]
    const abi = parseAbi(POLYNOMIAL_ABI)

    const stakeTxData = encodeFunctionData({
      abi,
      functionName: 'initiateDeposit',
      args: [account.address, amount],
    })

    const contractCallsQuoteRequest: ContractCallsQuoteRequest = {
      fromChain,
      fromToken,
      fromAddress: account.address,
      toChain: ChainId.OPT,
      toToken: sETH_OPT,
      toAmount: amount,
      contractCalls: [
        {
          fromAmount: amount,
          fromTokenAddress: sETH_OPT, // TODO: check if these are the correct values
          toContractAddress: POLYNOMIAL_ETHEREUM_CONTRACT_OPT,
          toContractCallData: stakeTxData,
          toContractGasLimit: POLYNOMIAL_GAS_LIMIT,
        },
      ],
    }
    console.info(
      '>> create contract calls quote request',
      contractCallsQuoteRequest
    )

    const contactCallsQuoteResponse = await getContractCallsQuote(
      contractCallsQuoteRequest
    )
    console.info('>> Contract Calls Quote', contactCallsQuoteResponse)

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
