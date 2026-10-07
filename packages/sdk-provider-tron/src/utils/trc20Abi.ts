import type { Types } from 'tronweb'

/**
 * The TRC-20 reads the SDK makes. With a static ABI, `tronWeb.contract(abi,
 * address)` needs no `wallet/getcontract` request, and TronWeb does not keep
 * the token's ABI and bytecode in `trx.cache.contracts`, which never shrinks.
 */
export const TRC20_ABI: Types.ContractAbiInterface = [
  {
    inputs: [{ name: 'owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
]
