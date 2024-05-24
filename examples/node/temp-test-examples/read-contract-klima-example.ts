import {
  http,
  getContract,
  createWalletClient,
  publicActions,
  parseAbi,
  parseEther,
  encodeFunctionData,
} from 'viem'
import { polygon } from 'viem/chains'
import type { Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import 'dotenv/config'

const USDC_POL = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'
const BCT_POL = '0x2F800Db0fdb5223b3C3f354886d907A671414A7F'

// https://docs.klimadao.finance/developers/contracts/retirement/v2-diamond/generalized-retirement
const KLIMA_ETHEREUM_CONTRACT_OPT = '0x8cE54d9625371fb2a068986d32C85De8E6e995f8'

const KLIMA_ABI = [
  'function getSourceAmountDefaultRetirement(address,address,uint256) external view returns (uint256 amountIn)',
  'function retireExactCarbonDefault(address, address, uint256, uint256, string, address, string, string, uint8)',
]

// TODO: this was file should be removed - create to help me figure out what the contract call looks like with viem
const run = async () => {
  console.info('Klima example')

  const privateKey = process.env.PRIVATE_KEY as Address

  const account = privateKeyToAccount(privateKey)

  const walletClient = createWalletClient({
    account,
    chain: polygon,
    transport: http(),
  }).extend(publicActions)

  const abi = parseAbi(KLIMA_ABI)

  console.log('ABI parsed:', JSON.stringify(abi, null, 2))

  const contract = getContract({
    address: KLIMA_ETHEREUM_CONTRACT_OPT,
    abi,
    client: walletClient as any,
  })

  console.log('contract recieved:', contract)

  const retireAmount = parseEther('1').toString()

  const sourceAmountDefaultRetirement = await (
    contract as any
  ).read.getSourceAmountDefaultRetirement([
    USDC_POL, // address sourceToken,
    BCT_POL, // address poolToken,
    parseEther('1').toString(), // uint256 retireAmount,
  ])

  const usdcAmount = sourceAmountDefaultRetirement.toString()
  console.log('sourceAmountDefaultRetirement read:', usdcAmount)

  const data = encodeFunctionData({
    abi,
    functionName: 'retireExactCarbonDefault',
    args: [
      USDC_POL, // address sourceToken,
      BCT_POL, // address poolToken,
      usdcAmount, // uint256 maxAmountIn,
      retireAmount, // uint256 retireAmount,
      'LI.FI', // string memory retiringEntityString,
      '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0', // address beneficiaryAddress,
      'LI.FI', // string memory beneficiaryString,
      'Cross Chain Contract Calls', // string memory retirementMessage,
      0, // LibTransfer.From fromMode],
    ],
  })

  console.log('data recieve', data)
}

run()
