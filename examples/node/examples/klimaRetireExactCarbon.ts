import * as lifiDataTypes from '@lifi/data-types'
import type { ContractCallsQuoteRequest, StatusResponse } from '@lifi/sdk'
import {
  ChainId,
  CoinKey,
  createConfig,
  EVM,
  getContractCallsQuote,
  getStatus,
  getTokenAllowance,
  setTokenAllowance,
} from '@lifi/sdk'
import type { Chain, Address, Hash } from 'viem'
import {
  parseAbi,
  encodeFunctionData,
  parseUnits,
  createPublicClient,
  http,
  createWalletClient,
  publicActions,
} from 'viem'
import { mainnet, arbitrum, optimism, polygon } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import 'dotenv/config'
import { promptConfirm } from '../helpers/promptConfirm'
import type { WalletClientWithPublicActions } from './types'
import { AddressZero } from './constants'

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
    }).extend(publicActions) as WalletClientWithPublicActions

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

    // config
    const fromChain = ChainId.OPT
    const fromToken = findDefaultToken(CoinKey.USDC, ChainId.OPT).address
    const retireAmount = '100000' // 1 USDC
    const USDCe_POL = findDefaultToken(CoinKey.USDCe, ChainId.POL)
    const Base_Carbon_Tonne_POL = '0x2F800Db0fdb5223b3C3f354886d907A671414A7F'
    // https://docs.klimadao.finance/developers/contracts/retirement/v2-diamond/generalized-retirement
    const KLIMA_ETHEREUM_CONTRACT_POL =
      '0x8cE54d9625371fb2a068986d32C85De8E6e995f8'
    const KLIMA_GAS_LIMIT = '1300000'
    const KLIMA_ABI = [
      'function getSourceAmountDefaultRetirement(address,address,uint256) external view returns (uint256 amountIn)',
      'function retireExactCarbonDefault(address, address, uint256, uint256, string, address, string, string, uint8)',
    ]
    const abi = parseAbi(KLIMA_ABI)

    const publicClient = createPublicClient({
      chain: polygon,
      transport: http(),
    })

    const sourceAmountDefaultRetirement = await publicClient.readContract({
      address: KLIMA_ETHEREUM_CONTRACT_POL,
      abi,
      functionName: 'getSourceAmountDefaultRetirement',
      args: [
        USDCe_POL.address, // address sourceToken,
        Base_Carbon_Tonne_POL, // address poolToken,
        retireAmount, // uint256 retireAmount,
      ],
    })

    const usdcAmount = parseUnits(
      sourceAmountDefaultRetirement.toString(),
      USDCe_POL.decimals
    ).toString()

    console.log('>> usdcAmount', usdcAmount)

    const retireTxData = encodeFunctionData({
      abi,
      functionName: 'retireExactCarbonDefault',
      args: [
        USDCe_POL.address, // address sourceToken,
        Base_Carbon_Tonne_POL, // address poolToken,
        usdcAmount, // uint256 maxAmountIn,
        retireAmount, // uint256 retireAmount,
        'LI.FI', // string memory retiringEntityString,
        '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0', // address beneficiaryAddress,
        'LI.FI', // string memory beneficiaryString,
        'Cross Chain Contract Calls', // string memory retirementMessage,
        0, // LibTransfer.From fromMode],
      ],
    })

    // quote
    const contractCallsQuoteRequest: ContractCallsQuoteRequest = {
      fromChain,
      fromToken,
      fromAddress: account.address,
      toChain: ChainId.POL,
      toToken: USDCe_POL.address,
      toAmount: usdcAmount,
      contractCalls: [
        {
          fromAmount: usdcAmount,
          fromTokenAddress: USDCe_POL.address,
          toContractAddress: KLIMA_ETHEREUM_CONTRACT_POL,
          toContractCallData: retireTxData,
          toContractGasLimit: KLIMA_GAS_LIMIT,
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
