import type { Address, Client, Hex, TypedDataDomain } from 'viem'
import {
  encodeAbiParameters,
  keccak256,
  pad,
  parseAbiParameters,
  toBytes,
  toHex,
  zeroHash,
} from 'viem'
import { getCode, multicall, readContract } from 'viem/actions'
import { eip2612Abi } from '../abi.js'
import { getActionWithFallback } from '../getActionWithFallback.js'
import { getMulticallAddress, isDelegationDesignatorCode } from '../utils.js'
import {
  DAI_LIKE_PERMIT_TYPEHASH,
  EIP712_DOMAIN_TYPEHASH,
  EIP712_DOMAIN_TYPEHASH_WITH_SALT,
  eip2612Types,
} from './constants.js'
import type { NativePermitData } from './types.js'

type GetNativePermitParams = {
  chainId: number
  tokenAddress: Address
  spenderAddress: Address
  amount: bigint
}

function makeDomainSeparator({
  name,
  version,
  chainId,
  verifyingContract,
  withSalt = false,
}: {
  name: string
  version: string
  chainId: number
  verifyingContract: Address
  withSalt?: boolean
}): Hex {
  const nameHash = keccak256(toBytes(name))
  const versionHash = keccak256(toBytes(version))

  const encoded = withSalt
    ? encodeAbiParameters(
        parseAbiParameters('bytes32, bytes32, bytes32, address, bytes32'),
        [
          EIP712_DOMAIN_TYPEHASH_WITH_SALT,
          nameHash,
          versionHash,
          verifyingContract,
          pad(toHex(chainId), { size: 32 }),
        ]
      )
    : encodeAbiParameters(
        parseAbiParameters('bytes32, bytes32, bytes32, uint256, address'),
        [
          EIP712_DOMAIN_TYPEHASH,
          nameHash,
          versionHash,
          BigInt(chainId),
          verifyingContract,
        ]
      )

  return keccak256(encoded)
}

function validateDomainSeparator({
  name,
  version,
  chainId,
  verifyingContract,
  domainSeparator,
}: {
  name: string
  version: string
  chainId: number
  verifyingContract: Address
  domainSeparator: Hex
}): { isValid: boolean; domain: TypedDataDomain } {
  if (!name || !domainSeparator) {
    return {
      isValid: false,
      domain: {},
    }
  }

  for (const withSalt of [false, true]) {
    const computedDS = makeDomainSeparator({
      name,
      version,
      chainId,
      verifyingContract,
      withSalt,
    })
    if (domainSeparator.toLowerCase() === computedDS.toLowerCase()) {
      return {
        isValid: true,
        domain: withSalt
          ? {
              name,
              version,
              verifyingContract,
              salt: pad(toHex(chainId), { size: 32 }),
            }
          : {
              name,
              version,
              chainId,
              verifyingContract,
            },
      }
    }
  }

  return {
    isValid: false,
    domain: {},
  }
}

/**
 * Checks if the account can use native permits based on its code.
 * Returns true if:
 * 1. Account has no code (EOA)
 * 2. Account is EOA and has EIP-7702 delegation designator code
 *
 * @param client - The Viem client instance
 * @returns Promise<boolean> - Whether the account can use native permits
 */
const canAccountUseNativePermits = async (client: Client): Promise<boolean> => {
  try {
    const accountCode = await getActionWithFallback(
      client,
      getCode,
      'getCode',
      {
        address: client.account!.address,
      }
    )

    // If no code (0x or undefined), it's an EOA - can use native permits
    if (!accountCode || accountCode === '0x') {
      return true
    }

    // If has code but it's EIP-7702 delegation designator - can use native permits
    if (isDelegationDesignatorCode(accountCode)) {
      return true
    }

    // If has code but not EIP-7702 delegation - cannot use native permits
    // Smart Accounts like Kernel (ZeroDev) can't produce ECDSA signatures, so we can't use native permits in current implementation
    return false
  } catch {
    // If we can't check the code, assume it's not safe to use native permits
    return false
  }
}

/**
 * Attempts to retrieve contract data using EIP-5267 eip712Domain() function
 * @link https://eips.ethereum.org/EIPS/eip-5267
 * @param client - The Viem client instance
 * @param chainId - The chain ID
 * @param tokenAddress - The token contract address
 * @returns Contract data if EIP-5267 is supported, undefined otherwise
 */
const getEIP712DomainData = async (
  client: Client,
  chainId: number,
  tokenAddress: Address
) => {
  try {
    const multicallAddress = await getMulticallAddress(chainId)

    const contractCalls = [
      {
        address: tokenAddress,
        abi: eip2612Abi,
        functionName: 'eip712Domain',
      },
      {
        address: tokenAddress,
        abi: eip2612Abi,
        functionName: 'nonces',
        args: [client.account!.address],
      },
    ] as const

    if (multicallAddress) {
      try {
        const [eip712DomainResult, noncesResult] = await getActionWithFallback(
          client,
          multicall,
          'multicall',
          {
            contracts: contractCalls,
            multicallAddress,
          }
        )

        if (
          eip712DomainResult.status !== 'success' ||
          noncesResult.status !== 'success' ||
          !eip712DomainResult.result ||
          noncesResult.result === undefined
        ) {
          // Fall back to individual calls if multicall fails
          throw new Error('EIP-5267 multicall failed')
        }

        const [, name, version, tokenChainId, verifyingContract, salt] =
          eip712DomainResult.result

        if (
          Number(tokenChainId) !== chainId ||
          verifyingContract.toLowerCase() !== tokenAddress.toLowerCase()
        ) {
          return undefined
        }

        // Build domain object directly from EIP-5267 data
        // Use the actual salt value returned by EIP-5267 - this is the canonical salt that the contract uses
        const hasSalt = salt !== zeroHash
        const domain = hasSalt
          ? {
              name,
              version,
              verifyingContract: tokenAddress,
              salt,
            }
          : {
              name,
              version,
              chainId,
              verifyingContract: tokenAddress,
            }

        return {
          name,
          version,
          domain,
          permitTypehash: undefined, // EIP-5267 doesn't provide permit typehash directly
          nonce: noncesResult.result,
        }
      } catch {
        // Fall through to individual calls
      }
    }

    // Fallback to individual contract calls
    const [eip712DomainResult, noncesResult] = (await Promise.allSettled(
      contractCalls.map((call) =>
        getActionWithFallback(client, readContract, 'readContract', call)
      )
    )) as [
      PromiseSettledResult<
        [Hex, string, string, bigint, Address, Hex, bigint[]]
      >,
      PromiseSettledResult<bigint>,
    ]

    if (
      eip712DomainResult.status !== 'fulfilled' ||
      noncesResult.status !== 'fulfilled'
    ) {
      return undefined
    }

    const [, name, version, tokenChainId, verifyingContract, salt] =
      eip712DomainResult.value

    if (
      Number(tokenChainId) !== chainId ||
      verifyingContract.toLowerCase() !== tokenAddress.toLowerCase()
    ) {
      return undefined
    }

    // Build domain object directly from EIP-5267 data
    // Use the actual salt value returned by EIP-5267 - this is the canonical salt that the contract uses
    const hasSalt = salt !== zeroHash
    const domain = hasSalt
      ? {
          name,
          version,
          verifyingContract: tokenAddress,
          salt,
        }
      : {
          name,
          version,
          chainId,
          verifyingContract: tokenAddress,
        }

    return {
      name,
      version,
      domain,
      permitTypehash: undefined, // EIP-5267 doesn't provide permit typehash directly
      nonce: noncesResult.value,
    }
  } catch {
    return undefined
  }
}

const getContractData = async (
  client: Client,
  chainId: number,
  tokenAddress: Address
) => {
  try {
    // First try EIP-5267 approach - returns domain object directly
    const eip5267Data = await getEIP712DomainData(client, chainId, tokenAddress)
    if (eip5267Data) {
      return eip5267Data
    }

    // Fallback to legacy approach - validates and returns domain object
    const multicallAddress = await getMulticallAddress(chainId)

    const contractCalls = [
      {
        address: tokenAddress,
        abi: eip2612Abi,
        functionName: 'name',
      },
      {
        address: tokenAddress,
        abi: eip2612Abi,
        functionName: 'DOMAIN_SEPARATOR',
      },
      {
        address: tokenAddress,
        abi: eip2612Abi,
        functionName: 'PERMIT_TYPEHASH',
      },
      {
        address: tokenAddress,
        abi: eip2612Abi,
        functionName: 'nonces',
        args: [client.account!.address],
      },
      {
        address: tokenAddress,
        abi: eip2612Abi,
        functionName: 'version',
      },
    ] as const

    if (multicallAddress) {
      try {
        const [
          nameResult,
          domainSeparatorResult,
          permitTypehashResult,
          noncesResult,
          versionResult,
        ] = await getActionWithFallback(client, multicall, 'multicall', {
          contracts: contractCalls,
          multicallAddress,
        })

        if (
          nameResult.status !== 'success' ||
          domainSeparatorResult.status !== 'success' ||
          noncesResult.status !== 'success' ||
          !nameResult.result ||
          !domainSeparatorResult.result ||
          noncesResult.result === undefined
        ) {
          // Fall back to individual calls if multicall fails
          throw new Error('Multicall failed')
        }

        // Validate domain separator and create domain object
        const { isValid, domain } = validateDomainSeparator({
          name: nameResult.result,
          version: versionResult.result ?? '1',
          chainId,
          verifyingContract: tokenAddress,
          domainSeparator: domainSeparatorResult.result,
        })

        if (!isValid) {
          return undefined
        }

        return {
          name: nameResult.result,
          domain,
          permitTypehash: permitTypehashResult.result,
          nonce: noncesResult.result,
          version: versionResult.result ?? '1',
        }
      } catch {
        // Fall through to individual calls
      }
    }

    const [
      nameResult,
      domainSeparatorResult,
      permitTypehashResult,
      noncesResult,
      versionResult,
    ] = (await Promise.allSettled(
      contractCalls.map((call) =>
        getActionWithFallback(client, readContract, 'readContract', call)
      )
    )) as [
      PromiseSettledResult<string>,
      PromiseSettledResult<Hex>,
      PromiseSettledResult<Hex>,
      PromiseSettledResult<bigint>,
      PromiseSettledResult<string>,
    ]

    if (
      nameResult.status !== 'fulfilled' ||
      domainSeparatorResult.status !== 'fulfilled' ||
      noncesResult.status !== 'fulfilled'
    ) {
      return undefined
    }

    const name = nameResult.value
    const version =
      versionResult.status === 'fulfilled' ? versionResult.value : '1'

    // Validate domain separator and create domain object
    const { isValid, domain } = validateDomainSeparator({
      name,
      version,
      chainId,
      verifyingContract: tokenAddress,
      domainSeparator: domainSeparatorResult.value,
    })

    if (!isValid) {
      return undefined
    }

    return {
      name,
      domain,
      permitTypehash:
        permitTypehashResult.status === 'fulfilled'
          ? permitTypehashResult.value
          : undefined,
      nonce: noncesResult.value,
      version,
    }
  } catch {
    return undefined
  }
}

/**
 * Retrieves native permit data (EIP-2612) for a token on a specific chain
 * @link https://eips.ethereum.org/EIPS/eip-2612
 * @param client - The Viem client instance
 * @param chain - The extended chain object containing chain details
 * @param tokenAddress - The address of the token to check for permit support
 * @returns {Promise<NativePermitData>} Object containing permit data including name, version, nonce and support status
 */
export const getNativePermit = async (
  client: Client,
  { chainId, tokenAddress, spenderAddress, amount }: GetNativePermitParams
): Promise<NativePermitData | undefined> => {
  // Check if the account can use native permits (EOA or EIP-7702 delegated account)
  const canUsePermits = await canAccountUseNativePermits(client)
  if (!canUsePermits) {
    return undefined
  }

  const contractData = await getContractData(client, chainId, tokenAddress)
  if (!contractData) {
    return undefined
  }

  // We don't support DAI-like permits yet (e.g. DAI on Ethereum)
  // https://eips.ethereum.org/EIPS/eip-2612#backwards-compatibility
  if (contractData.permitTypehash === DAI_LIKE_PERMIT_TYPEHASH) {
    return undefined
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60).toString() // 30 minutes

  const message = {
    owner: client.account!.address,
    spender: spenderAddress,
    value: amount.toString(),
    nonce: contractData.nonce.toString(),
    deadline,
  }

  return {
    primaryType: 'Permit',
    domain: contractData.domain,
    types: eip2612Types,
    message,
  }
}
