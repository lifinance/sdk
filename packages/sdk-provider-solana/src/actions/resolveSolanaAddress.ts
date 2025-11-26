import { getSNSAddress } from './getSNSAddress.js'

export async function resolveSolanaAddress(
  name: string
): Promise<string | undefined> {
  return await getSNSAddress(name)
}
