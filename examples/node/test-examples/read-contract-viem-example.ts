import {
  http,
  getContract,
  createWalletClient,
  publicActions,
  WalletClient,
} from 'viem'
import { mainnet } from 'viem/chains'
import type { Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import 'dotenv/config'

export const wagmiAbi = [
  {
    inputs: [],
    name: 'totalSupply',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    name: 'Transfer',
    type: 'event',
    inputs: [
      {
        indexed: true,
        name: 'from',
        type: 'address',
      },
      { indexed: true, name: 'to', type: 'address' },
      {
        indexed: true,
        name: 'tokenId',
        type: 'uint256',
      },
    ],
  },
] as const

// example taken from
// https://viem.sh/docs/contract/getContract#usage
const run = async () => {
  console.info('Viem example - https://viem.sh/docs/contract/getContract#usage')
  const privateKey = process.env.PRIVATE_KEY as Address

  const account = privateKeyToAccount(privateKey)

  const walletClient = createWalletClient({
    account,
    chain: mainnet,
    transport: http(),
  }).extend(publicActions)

  const contract = getContract({
    address: '0xFBA3912Ca04dd458c843e2EE08967fC04f3579c2',
    abi: wagmiAbi,
    client: walletClient as any,
  })

  console.log('contract recieved:', contract)

  const result = await (contract as any).read.totalSupply()

  console.log('result read:', result.toString())
}

run()
