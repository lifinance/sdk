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
import {
  http,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  parseAbi,
  parseUnits,
  publicActions,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrum, mainnet, optimism, polygon } from 'viem/chains'
import 'dotenv/config'
import { promptConfirm } from '../helpers/promptConfirm'
import { checkTokenAllowance } from './utils/checkTokenAllowance'
import { transformTxRequestToSendTxParams } from './utils/transformTxRequestToSendTxParams'

const { findDefaultToken } = (lifiDataTypes as any).default

const run = async () => {
  console.info('>> Klima Retire Demo: Retire(burn) Carbon tokens to offset CO2')

  try {
    console.info('>> Initialize LiFi SDK')
    const privateKey = process.env.PRIVATE_KEY as Address

    // NOTE: Here we are using the private key to get the account,
    // but you can also use a Mnemonic account - see https://viem.sh/docs/accounts/mnemonic
    const account = privateKeyToAccount(privateKey)

    const client = createWalletClient({
      account,
      chain: optimism as Chain,
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

    // config for klima contract run - https://docs.klimadao.finance/developers/contracts/retirement/v2-diamond/generalized-retirement
    const config = {
      fromChain: ChainId.OPT,
      // the Klima Contract is on Polygon
      toChain: ChainId.POL,
      fromToken: findDefaultToken(CoinKey.USDC, ChainId.OPT).address,
      retireAmount: '100000', // USDC
      klimaContractAddress:
        '0x8cE54d9625371fb2a068986d32C85De8E6e995f8' as Address, // Klima Ethereum Contract on Polygon
      klimaContractSourceToken: findDefaultToken(CoinKey.USDCe, ChainId.POL), // USDCe POL
      klimaContractPoolTokenAddress:
        '0x2F800Db0fdb5223b3C3f354886d907A671414A7F', // Base Carbon Tonne Polygon
      klimaContractGasLimit: '1300000',
      klimaContractAbi: [
        'function getSourceAmountDefaultRetirement(address,address,uint256) external view returns (uint256 amountIn)',
        'function retireExactCarbonDefault(address, address, uint256, uint256, string, address, string, string, uint8)',
      ],
      klimaContractRetiringEntityString: 'LI.FI',
      klimaContractBeneficiaryAddress:
        '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0',
      klimaContractBeneficiaryString: 'LI.FI',
      klimaContractRetirementMessage: 'Cross Chain Contract Calls',
      klimaContractFromMode: 0,
    }

    const abi = parseAbi(config.klimaContractAbi)

    const publicClient = createPublicClient({
      chain: polygon,
      transport: http(),
    })

    const sourceAmountDefaultRetirement = (await publicClient.readContract({
      address: config.klimaContractAddress,
      abi,
      functionName: 'getSourceAmountDefaultRetirement',
      args: [
        config.klimaContractSourceToken.address,
        config.klimaContractPoolTokenAddress,
        config.retireAmount, // uint256 retireAmount,
      ],
    })) as bigint

    const usdcAmount = parseUnits(
      sourceAmountDefaultRetirement.toString(),
      config.klimaContractSourceToken.decimals
    ).toString()

    const retireTxData = encodeFunctionData({
      abi,
      functionName: 'retireExactCarbonDefault',
      args: [
        config.klimaContractSourceToken.address, // address sourceToken,
        config.klimaContractPoolTokenAddress, // address poolToken,
        usdcAmount, // uint256 maxAmountIn,
        config.retireAmount, // uint256 retireAmount,
        config.klimaContractRetiringEntityString, // string memory retiringEntityString,
        config.klimaContractBeneficiaryAddress, // address beneficiaryAddress,
        config.klimaContractBeneficiaryString, // string memory beneficiaryString,
        config.klimaContractRetirementMessage, // string memory retirementMessage,
        config.klimaContractFromMode, // LibTransfer.From fromMode],
      ],
    })

    const contractCallsQuoteRequest: ContractCallsQuoteRequest = {
      fromChain: config.fromChain,
      fromToken: config.fromToken,
      fromAddress: account.address,
      toChain: config.toChain,
      toToken: config.klimaContractSourceToken.address,
      toAmount: usdcAmount,
      allowBridges: ['hop', 'across', 'amarok'],
      contractCalls: [
        {
          fromAmount: usdcAmount,
          fromTokenAddress: config.klimaContractSourceToken.address,
          toContractAddress: config.klimaContractAddress,
          toContractCallData: retireTxData,
          toContractGasLimit: config.klimaContractGasLimit,
        },
      ],
    }
    console.info(
      '>> create ContractCallsQuoteRequest',
      contractCallsQuoteRequest
    )

    const contactCallsQuoteResponse = await getContractCallsQuote(
      contractCallsQuoteRequest
    )
    console.info('>> Quote received', contactCallsQuoteResponse)

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
