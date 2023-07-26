import type { Abi } from 'viem'

export const approveAbi: Abi = [
  {
    name: 'approve',
    inputs: [
      { internalType: 'address', name: 'spender', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
    ],
    outputs: [{ internalType: 'bool', name: 'approved', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
]

export const allowanceAbi: Abi = [
  {
    name: 'allowance',
    inputs: [
      { internalType: 'address', name: 'owner', type: 'address' },
      { internalType: 'address', name: 'spender', type: 'address' },
    ],
    outputs: [{ internalType: 'uint256', name: 'allowance', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
]

export const getEthBalanceAbi: Abi = [
  {
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'getEthBalance',
    outputs: [{ name: 'balance', type: 'uint256' }],
    type: 'function',
    stateMutability: 'view',
  },
]

export const balanceOfAbi: Abi = [
  {
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    type: 'function',
    stateMutability: 'view',
  },
]
