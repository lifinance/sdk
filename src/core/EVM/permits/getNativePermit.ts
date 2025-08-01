import type { Address, Client, Hex, TypedDataDomain } from 'viem'
import {
  encodeAbiParameters,
  keccak256,
  pad,
  parseAbiParameters,
  toBytes,
  toHex,
} from 'viem'
import { multicall, readContract } from 'viem/actions'
import { eip2612Abi } from '../abi.js'
import { getActionWithFallback } from '../getActionWithFallback.js'
import { getMulticallAddress } from '../utils.js'
import {
  DAI_LIKE_PERMIT_TYPEHASH,
  EIP712_DOMAIN_TYPEHASH,
  EIP712_DOMAIN_TYPEHASH_WITH_SALT,
  eip2612Types,
} from './constants.js'
import type { NativePermitData } from './types.js'

export type GetNativePermitParams = {
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

// TODO: Add support for EIP-5267 when adoption increases
// This EIP provides a standard way to query domain separator and permit type hash
// via eip712Domain() function, which would simplify permit validation
// https://eips.ethereum.org/EIPS/eip-5267
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

export const getContractData = async (
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

        return {
          name: nameResult.result,
          domainSeparator: domainSeparatorResult.result,
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

    return {
      name,
      domainSeparator: domainSeparatorResult.value,
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
  const contractData = await getContractData(client, chainId, tokenAddress)
  if (!contractData) {
    return undefined
  }
  const { name, domainSeparator, permitTypehash, nonce, version } = contractData

  // We don't support DAI-like permits yet (e.g. DAI on Ethereum)
  if (permitTypehash === DAI_LIKE_PERMIT_TYPEHASH) {
    return undefined
  }

  const { isValid, domain } = validateDomainSeparator({
    name,
    version,
    chainId,
    verifyingContract: tokenAddress,
    domainSeparator,
  })

  if (!isValid) {
    return undefined
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60).toString() // 30 minutes

  const message = {
    owner: client.account!.address,
    spender: spenderAddress,
    value: amount.toString(),
    nonce: nonce.toString(),
    deadline,
  }

  return {
    primaryType: 'Permit',
    domain,
    types: eip2612Types,
    message,
  }
}
