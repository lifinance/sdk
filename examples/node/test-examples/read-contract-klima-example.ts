import {
  http,
  getContract,
  createWalletClient,
  publicActions,
  parseAbi,
  parseEther,
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
const run = async () => {
  console.info('Klima example')

  const privateKey = process.env.PRIVATE_KEY as Address

  const account = privateKeyToAccount(privateKey)

  const walletClient = createWalletClient({
    account,
    chain: polygon, // does this need to be polygon?
    transport: http(),
  }).extend(publicActions)

  const abi = parseAbi(KLIMA_ABI)

  console.log('ABI parsed:', abi)

  const contract = getContract({
    address: KLIMA_ETHEREUM_CONTRACT_OPT,
    abi: parseAbi(KLIMA_ABI),
    client: walletClient as any,
  })

  console.log('contract recieved:', contract)

  const result = await (contract as any).read.getSourceAmountDefaultRetirement(
    USDC_POL, // address sourceToken,
    BCT_POL, // address poolToken,
    parseEther('1').toString() // uint256 retireAmount,
  )

  console.log('result read:', result.toString())
}

run()
