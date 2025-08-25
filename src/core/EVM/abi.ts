import { parseAbi } from 'viem'

export const permit2ProxyAbi = parseAbi([
  'function callDiamondWithPermit2(bytes, ((address, uint256), uint256, uint256), bytes) external',
  'function callDiamondWithEIP2612Signature(address, uint256, uint256, uint8, bytes32, bytes32, bytes) external payable',
  'function nextNonce(address) external view returns (uint256)',
  'function callDiamondWithPermit2Witness(bytes, address, ((address, uint256), uint256, uint256), bytes) external payable',
])

export const eip2612Abi = parseAbi([
  'function permit(address, address, uint256, uint256, uint8, bytes32, bytes32) external',
  'function DOMAIN_SEPARATOR() external view returns (bytes32)',
  'function nonces(address) external view returns (uint256)',
  'function name() external view returns (string)',
  'function version() external view returns (string)',
  'function PERMIT_TYPEHASH() external view returns (bytes32)',
  // EIP-5267
  'function eip712Domain() external view returns (bytes1, string, string, uint256, address, bytes32, uint256[])',
])

export const approveAbi = parseAbi([
  'function approve(address, uint256) external returns (bool)',
])

export const allowanceAbi = parseAbi([
  'function allowance(address, address) external view returns (uint256)',
])

export const getEthBalanceAbi = parseAbi([
  'function getEthBalance(address) external view returns (uint256)',
])

export const balanceOfAbi = parseAbi([
  'function balanceOf(address) external view returns (uint256)',
])
