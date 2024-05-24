import {
  http,
  getContract,
  createWalletClient,
  publicActions,
  parseAbi,
  parseEther,
  encodeFunctionData,
} from 'viem'
import { optimism } from 'viem/chains'
import type { Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import 'dotenv/config'

const POLYNOMIAL_ETHEREUM_CONTRACT_OPT =
  '0x2D46292cbB3C601c6e2c74C32df3A4FCe99b59C7'
const POLYNOMIAL_ABI = [
  'function initiateDeposit(address user, uint amount) external',
]

// TODO: this was file should be removed - create to help me figure out what the contract call looks like with viem
const run = async () => {
  console.info('Polynomial example')

  const privateKey = process.env.PRIVATE_KEY as Address

  const account = privateKeyToAccount(privateKey)

  const walletClient = createWalletClient({
    account,
    chain: optimism,
    transport: http(),
  }).extend(publicActions)

  const abi = parseAbi(POLYNOMIAL_ABI)

  console.log('ABI parsed:', JSON.stringify(abi, null, 2))

  const contract = getContract({
    address: POLYNOMIAL_ETHEREUM_CONTRACT_OPT,
    abi,
    client: walletClient as any,
  })

  console.log('contract recieved:', contract)

  const data = encodeFunctionData({
    abi,
    functionName: 'initiateDeposit',
    args: [account.address, parseEther('0.04').toString()],
  })

  console.log('data recieve', data)
}

run()
