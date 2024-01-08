import type { ContractCallQuoteRequest, LiFiStep } from '@lifi/sdk'
import { ChainId } from '@lifi/sdk'
import { ethers } from 'ethers'
import {
  executeCrossChainQuote,
  getLifi,
  getSigner,
  promptConfirm,
} from '../helpers'

const getPrePoQuote = async (
  fromChain: ChainId,
  fromToken: string,
  userAddress: string,
  amount: string
): Promise<LiFiStep> => {
  const DEPOSIT_TRADE_HELPER_ETHEREUM_CONTRACT_ARB =
    '0x2fa567576f9250666E3D81984Ad3b373028a881C'
  const DEPOSIT_TRADE_HELPER_ABI = [
    {
      inputs: [
        { internalType: 'address', name: 'recipient', type: 'address' },
        {
          components: [
            {
              internalType: 'uint256',
              name: 'amountOutMinimum',
              type: 'uint256',
            },
            { internalType: 'uint256', name: 'deadline', type: 'uint256' },
          ],
          internalType: 'struct IDepositTradeHelper.OffChainBalancerParams',
          name: 'balancerParams',
          type: 'tuple',
        },
      ],
      name: 'wrapAndDeposit',
      outputs: [],
      stateMutability: 'payable',
      type: 'function',
    },
  ]
  const DEPOSIT_TRADE_HELPER_GAS_LIMIT = '2000000'

  const amountOutMinimum = ethers.BigNumber.from(amount)
    .mul(85)
    .div(100)
    .toString()
  const deadline = Date.now() + 3600

  // contract call
  const contract = new ethers.Contract(
    DEPOSIT_TRADE_HELPER_ETHEREUM_CONTRACT_ARB,
    DEPOSIT_TRADE_HELPER_ABI
  )
  const stakeTx = await contract.populateTransaction.wrapAndDeposit(
    userAddress,
    [amountOutMinimum, deadline]
  )

  // quote
  const quoteRequest: ContractCallQuoteRequest = {
    fromChain,
    fromToken,
    fromAddress: userAddress,
    toChain: ChainId.ARB,
    toToken: ethers.constants.AddressZero,
    toAmount: amount,
    toContractAddress: stakeTx.to!,
    toContractCallData: stakeTx.data!,
    toContractGasLimit: DEPOSIT_TRADE_HELPER_GAS_LIMIT,
  }

  return getLifi().getContractCallQuote(quoteRequest)
}

const run = async () => {
  console.log('PrePO Demo: Deposit ETH on Arbitrum')

  // config
  const fromChain = ChainId.OPT
  const fromToken = '0x7F5c764cBc14f9669B88837ca1490cCa17c31607' // USDC
  const amount = ethers.utils.parseEther('0.0001').toString()
  const receiver = '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0'

  try {
    // get quote
    const quote = await getPrePoQuote(fromChain, fromToken, receiver, amount)
    console.log('Quote', quote)

    // continue?
    if (!(await promptConfirm('Execute Quote?'))) {
      return
    }

    // execute quote
    const signer = await getSigner(fromChain)
    await executeCrossChainQuote(signer, quote)
  } catch (e) {
    console.error(e)
  }
}

run()
