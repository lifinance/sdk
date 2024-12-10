import type { ExtendedChain } from '@lifi/types'
import type { Address, Client } from 'viem'
import { multicall, readContract } from 'viem/actions'
import { eip2612Abi } from './abi.js'
import { getMulticallAddress } from './utils.js'

export type NativePermitData = {
  name: string
  version: string
  nonce: bigint
  supported: boolean
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
  chain: ExtendedChain,
  tokenAddress: Address
): Promise<NativePermitData> => {
  try {
    const multicallAddress = await getMulticallAddress(chain.id)

    if (multicallAddress) {
      const [nameResult, domainSeparatorResult, noncesResult, versionResult] =
        await multicall(client, {
          contracts: [
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
              functionName: 'nonces',
              args: [client.account!.address],
            },
            {
              address: tokenAddress,
              abi: eip2612Abi,
              functionName: 'version',
            },
          ],
          multicallAddress,
        })

      const supported =
        nameResult.status === 'success' &&
        domainSeparatorResult.status === 'success' &&
        noncesResult.status === 'success' &&
        !!nameResult.result &&
        !!domainSeparatorResult.result &&
        noncesResult.result !== undefined

      return {
        name: nameResult.result!,
        version: versionResult.result ?? '1',
        nonce: noncesResult.result!,
        supported,
      }
    }

    // Fallback to individual calls
    const [name, domainSeparator, nonce, version] = await Promise.all([
      readContract(client, {
        address: tokenAddress,
        abi: eip2612Abi,
        functionName: 'name',
      }),
      readContract(client, {
        address: tokenAddress,
        abi: eip2612Abi,
        functionName: 'DOMAIN_SEPARATOR',
      }),
      readContract(client, {
        address: tokenAddress,
        abi: eip2612Abi,
        functionName: 'nonces',
        args: [client.account!.address],
      }),
      readContract(client, {
        address: tokenAddress,
        abi: eip2612Abi,
        functionName: 'version',
      }),
    ])

    return {
      name,
      version: version ?? '1',
      nonce,
      supported: !!name && !!domainSeparator && nonce !== undefined,
    }
  } catch {
    return {
      name: '',
      version: '1',
      nonce: 0n,
      supported: false,
    }
  }
}
